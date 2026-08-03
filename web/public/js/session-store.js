// Único dono do estado de sessão no browser. Tokens ficam em sessionStorage
// para sobreviver a reloads, mas morrem quando a aba fecha.
const sessionStore = (() => {
  const STORAGE_KEY = 'striviapp-session';

  let state = {
    accessToken: null,
    refreshToken: null,
    elevationToken: null,
    elevationExpiresAtMs: null,
    accessExpiresAtMs: null,
    accessTtlSeconds: null,
    user: null,
  };

  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // sessionStorage indisponível (ex.: modo privado) — sessão vive só em memória.
    }
  }

  function load() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = { ...state, ...JSON.parse(raw) };
      }
    } catch {
      state = { ...state };
    }
    return state;
  }

  return {
    load,

    get user() {
      return state.user;
    },

    get accessToken() {
      return state.accessToken;
    },

    get refreshToken() {
      return state.refreshToken;
    },

    get elevationToken() {
      return state.elevationToken;
    },

    get accessExpiresAtMs() {
      return state.accessExpiresAtMs;
    },

    get accessTtlSeconds() {
      return state.accessTtlSeconds;
    },

    isLoggedIn() {
      return Boolean(state.accessToken && state.user);
    },

    isElevationLikelyValid() {
      return Boolean(
        state.elevationToken &&
          state.elevationExpiresAtMs &&
          state.elevationExpiresAtMs > Date.now(),
      );
    },

    saveSession({ accessToken, refreshToken, user, expiresInSeconds }) {
      state.accessToken = accessToken;
      state.refreshToken = refreshToken;
      state.user = user;
      if (expiresInSeconds != null && Number.isFinite(Number(expiresInSeconds))) {
        const ttl = Math.max(1, Number(expiresInSeconds));
        state.accessTtlSeconds = ttl;
        state.accessExpiresAtMs = Date.now() + ttl * 1000;
      }
      persist();
    },

    saveAccessToken(accessToken) {
      state.accessToken = accessToken;
      persist();
    },

    // Fallback após reload: usa exp do JWT só para o countdown da UI.
    syncAccessExpiryFromToken() {
      if (!state.accessToken) {
        return null;
      }
      try {
        const payloadPart = state.accessToken.split('.')[1];
        if (!payloadPart) {
          return null;
        }
        const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json);
        if (!payload.exp) {
          return null;
        }
        state.accessExpiresAtMs = payload.exp * 1000;
        if (!state.accessTtlSeconds && payload.iat) {
          state.accessTtlSeconds = Math.max(1, payload.exp - payload.iat);
        }
        persist();
        return state.accessExpiresAtMs;
      } catch {
        return null;
      }
    },

    saveElevation({ elevationToken, expiresInSeconds }) {
      state.elevationToken = elevationToken;
      state.elevationExpiresAtMs = Date.now() + expiresInSeconds * 1000;
      persist();
    },

    markTotpEnabled() {
      if (state.user) {
        state.user = { ...state.user, totpEnabled: true };
        persist();
      }
    },

    clearElevation() {
      state.elevationToken = null;
      state.elevationExpiresAtMs = null;
      persist();
    },

    clear() {
      state = {
        accessToken: null,
        refreshToken: null,
        elevationToken: null,
        elevationExpiresAtMs: null,
        accessExpiresAtMs: null,
        accessTtlSeconds: null,
        user: null,
      };
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // nada a limpar
      }
    },
  };
})();

window.sessionStore = sessionStore;
