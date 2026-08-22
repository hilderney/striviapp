// Controla login, elevação TOTP e visibilidade por role.
// A UI é só conveniência: o backend revalida role e elevação em toda rota.
// TEMP (versão de testes): TOTP / elevação desligados na UI.
const TOTP_DISABLED = true;

function initAuthUi({ onAuthenticated }) {
  const TAB_ROLES = {
    files: ['ADM', 'USER'],
    logs: ['ADM', 'USER'],
  };

  const loginScreen = document.getElementById('login-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  const totpSetupModal = document.getElementById('totp-setup-modal');
  const totpSetupStep = document.getElementById('totp-setup-step');
  const totpSetupQr = document.getElementById('totp-setup-qr');
  const totpSetupSecret = document.getElementById('totp-setup-secret');
  const totpSetupUri = document.getElementById('totp-setup-uri');
  const totpSetupForm = document.getElementById('totp-setup-form');
  const totpSetupError = document.getElementById('totp-setup-error');
  const totpSetupClose = document.getElementById('totp-setup-close');
  const totpPasswordForm = document.getElementById('totp-password-form');
  const totpPasswordError = document.getElementById('totp-password-error');
  const authenticatorButton = document.getElementById('btn-authenticator');

  const elevateModal = document.getElementById('elevate-modal');
  const elevateForm = document.getElementById('elevate-form');
  const elevateError = document.getElementById('elevate-error');

  const passwordModal = document.getElementById('password-modal');
  const passwordForm = document.getElementById('password-form');
  const passwordError = document.getElementById('password-error');
  const passwordSuccess = document.getElementById('password-success');
  const changePasswordButton = document.getElementById('btn-change-password');

  const userBadge = document.getElementById('user-badge');
  const subscriptionBadge = document.getElementById('subscription-badge');
  const sessionCountdown = document.getElementById('session-countdown');
  const logoutButton = document.getElementById('btn-logout');

  let appInitialized = false;
  let lastSubscription = null;
  let countdownTimerId = null;
  let refreshingOnExpiry = false;
  // false = primeiro cadastro obrigatório (não dá pra fechar); true = re-inscrição.
  let totpSetupDismissible = false;

  function show(element) {
    element.classList.remove('hidden');
    element.removeAttribute('hidden');
  }

  function hide(element) {
    element.classList.add('hidden');
    element.setAttribute('hidden', '');
  }

  function formatCountdown(totalSeconds) {
    const safe = Math.max(0, totalSeconds);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function stopSessionCountdown() {
    if (countdownTimerId != null) {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
    if (sessionCountdown) {
      sessionCountdown.textContent = '';
      sessionCountdown.classList.remove('session-countdown-urgent');
    }
  }

  function renderSessionCountdown() {
    if (!sessionCountdown || !sessionStore.isLoggedIn()) {
      stopSessionCountdown();
      return;
    }

    let expiresAt = sessionStore.accessExpiresAtMs;
    if (!expiresAt) {
      expiresAt = sessionStore.syncAccessExpiryFromToken();
    }
    if (!expiresAt) {
      sessionCountdown.textContent = '--:--';
      return;
    }

    const remainingSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
    sessionCountdown.textContent = formatCountdown(remainingSeconds);
    sessionCountdown.classList.toggle('session-countdown-urgent', remainingSeconds <= 60);

    if (remainingSeconds <= 0 && !refreshingOnExpiry) {
      refreshingOnExpiry = true;
      api
        ._tryRefreshSession()
        .then((ok) => {
          if (!ok) {
            sessionStore.clear();
            window.dispatchEvent(new CustomEvent('auth:logged-out'));
            return;
          }
          startSessionCountdown();
        })
        .finally(() => {
          refreshingOnExpiry = false;
        });
    }
  }

  function startSessionCountdown() {
    stopSessionCountdown();
    if (!sessionStore.isLoggedIn()) {
      return;
    }
    if (!sessionStore.accessExpiresAtMs) {
      sessionStore.syncAccessExpiryFromToken();
    }
    renderSessionCountdown();
    countdownTimerId = setInterval(renderSessionCountdown, 1000);
  }

  function showLoginScreen() {
    stopSessionCountdown();
    document.body.classList.remove('authenticated');
    show(loginScreen);
    hide(totpSetupModal);
    hide(elevateModal);
    hide(passwordModal);
    loginError.textContent = '';
    loginForm.reset();
    document.getElementById('login-username').focus();
  }

  function showDemoExpired(event) {
    showLoginScreen();
    loginError.textContent =
      event?.detail?.message || 'O limite do software de demonstração foi atingido.';
  }

  function applyRoleToTabs(role) {
    const allowedTabs = Object.entries(TAB_ROLES)
      .filter(([, roles]) => roles.includes(role))
      .map(([tab]) => tab);

    document.querySelectorAll('.tab').forEach((tab) => {
      const isAllowed = allowedTabs.includes(tab.dataset.tab);
      tab.style.display = isAllowed ? '' : 'none';
    });

    // Garante que a aba ativa é uma permitida (USER cai em "Arquivos").
    const firstAllowed = document.querySelector(`.tab[data-tab="${allowedTabs[0]}"]`);
    if (firstAllowed && !allowedTabs.includes(document.querySelector('.tab.active')?.dataset.tab)) {
      firstAllowed.click();
    }
  }

  function formatSubscriptionBadge(subscription, role) {
    if (!subscriptionBadge) {
      return;
    }
    // Demo: validade fixa do timer block (independente de role/assinatura).
    subscriptionBadge.textContent = 'Assinatura: Válida até 25/11/2026';
    subscriptionBadge.classList.remove('subscription-expired');
    if (subscription && subscription.active === false && role !== 'ADM') {
      subscriptionBadge.classList.add('subscription-expired');
    }
  }

  function enterApp(user, subscription = null) {
    hide(loginScreen);
    hide(totpSetupModal);
    document.body.classList.add('authenticated');
    userBadge.textContent = `${user.username} (${user.role})`;
    lastSubscription = subscription;
    formatSubscriptionBadge(subscription, user.role);
    applyRoleToTabs(user.role);
    startSessionCountdown();

    if (!appInitialized) {
      appInitialized = true;
      onAuthenticated();
    }
  }

  function resetTotpSetupUi() {
    totpSetupError.textContent = '';
    totpPasswordError.textContent = '';
    totpSetupForm.reset();
    totpPasswordForm.reset();
    totpSetupQr.removeAttribute('src');
    totpSetupSecret.textContent = '';
    totpSetupUri.textContent = '';
    hide(totpPasswordForm);
    hide(totpSetupStep);
  }

  function setTotpCloseVisible(visible) {
    if (!totpSetupClose) {
      return;
    }
    if (visible) {
      show(totpSetupClose);
    } else {
      hide(totpSetupClose);
    }
  }

  function showTotpQr(secret, otpauthUri, qrCodeDataUrl) {
    totpSetupQr.src = qrCodeDataUrl;
    totpSetupQr.alt = `QR Code TOTP para ${sessionStore.user?.username || 'usuário'}`;
    totpSetupSecret.textContent = secret;
    totpSetupUri.textContent = otpauthUri;
    totpSetupError.textContent = '';
    totpSetupForm.reset();
    hide(totpPasswordForm);
    show(totpSetupStep);
    document.getElementById('totp-setup-code').focus();
  }

  // Primeiro cadastro: sem senha, modal obrigatório. Re-inscrição: pede senha primeiro.
  async function openTotpSetup({ dismissible }) {
    totpSetupDismissible = dismissible;
    resetTotpSetupUi();
    setTotpCloseVisible(dismissible);
    hide(loginScreen);
    show(totpSetupModal);

    if (dismissible || sessionStore.user?.totpEnabled) {
      show(totpPasswordForm);
      document.getElementById('totp-password').focus();
      return;
    }

    const { secret, otpauthUri, qrCodeDataUrl } = await api.totpSetup();
    showTotpQr(secret, otpauthUri, qrCodeDataUrl);
  }

  function dismissTotpSetup() {
    if (!totpSetupDismissible) {
      return;
    }
    hide(totpSetupModal);
    resetTotpSetupUi();
  }

  async function handleTotpPasswordSubmit(event) {
    event.preventDefault();
    totpPasswordError.textContent = '';

    const password = document.getElementById('totp-password').value;
    try {
      const { secret, otpauthUri, qrCodeDataUrl } = await api.totpSetup(password);
      showTotpQr(secret, otpauthUri, qrCodeDataUrl);
    } catch (error) {
      totpPasswordError.textContent =
        error.code === 'TOTP_REENROLL_DENIED'
          ? 'Senha incorreta. Confirme para registrar um novo authenticator.'
          : error.message;
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    loginError.textContent = '';

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const session = await api.login(username, password);
      sessionStore.saveSession(session);
      // TEMP (versão de testes): pula cadastro/exigência de TOTP.
      if (TOTP_DISABLED || session.user.totpEnabled) {
        const me = await api.authMe();
        enterApp(me.user, me.subscription);
      } else {
        await openTotpSetup({ dismissible: false });
      }
    } catch (error) {
      loginError.textContent =
        error.code === 'DEMO_EXPIRED'
          ? 'O limite do software de demonstração foi atingido.'
          : error.code === 'INVALID_CREDENTIALS'
            ? 'Usuário ou senha inválidos.'
            : error.message;
    }
  }

  async function handleTotpSetupSubmit(event) {
    event.preventDefault();
    totpSetupError.textContent = '';

    try {
      await api.totpConfirm(document.getElementById('totp-setup-code').value.trim());
      sessionStore.markTotpEnabled();
      const me = await api.authMe();
      enterApp(me.user, me.subscription);
    } catch (error) {
      totpSetupError.textContent =
        error.code === 'INVALID_TOTP_CODE' ? 'Código inválido. Tente novamente.' : error.message;
    }
  }

  function handleAuthenticatorClick() {
    // TEMP (versão de testes): Authenticator desligado.
    if (TOTP_DISABLED) {
      return;
    }
    if (!sessionStore.isLoggedIn()) {
      return;
    }
    openTotpSetup({ dismissible: true }).catch((error) => {
      window.alert(error.message || 'Não foi possível abrir o cadastro do authenticator.');
    });
  }

  async function handleElevateSubmit(event) {
    event.preventDefault();
    elevateError.textContent = '';

    try {
      const elevation = await api.elevate(document.getElementById('elevate-code').value.trim());
      sessionStore.saveElevation(elevation);
      hide(elevateModal);
      elevateForm.reset();
    } catch (error) {
      elevateError.textContent =
        error.code === 'INVALID_TOTP_CODE' ? 'Código inválido. Tente novamente.' : error.message;
    }
  }

  function showElevateModal() {
    // TEMP (versão de testes): elevação TOTP desligada.
    if (TOTP_DISABLED) {
      return;
    }
    if (!sessionStore.isLoggedIn()) {
      return;
    }
    elevateError.textContent = '';
    elevateForm.reset();
    show(elevateModal);
    document.getElementById('elevate-code').focus();
  }

  function showPasswordModal() {
    if (!sessionStore.isLoggedIn()) {
      return;
    }
    passwordError.textContent = '';
    passwordSuccess.textContent = '';
    passwordForm.reset();
    show(passwordModal);
    document.getElementById('password-current').focus();
  }

  function describePasswordError(error) {
    switch (error.code) {
      case 'INVALID_CURRENT_PASSWORD':
        return 'Senha atual incorreta.';
      case 'PASSWORD_TOO_SHORT':
        return 'A nova senha precisa ter no mínimo 8 caracteres.';
      case 'PASSWORD_UNCHANGED':
        return 'A nova senha precisa ser diferente da atual.';
      default:
        return error.message;
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    passwordError.textContent = '';
    passwordSuccess.textContent = '';

    const currentPassword = document.getElementById('password-current').value;
    const newPassword = document.getElementById('password-new').value;
    const confirmation = document.getElementById('password-confirm').value;

    if (newPassword !== confirmation) {
      passwordError.textContent = 'A confirmação não corresponde à nova senha.';
      return;
    }

    try {
      const session = await api.changePassword(currentPassword, newPassword);
      // A troca revoga os refresh tokens antigos, inclusive o desta aba; o backend
      // devolve um par novo para a sessão atual continuar sem novo login.
      sessionStore.saveSession(session);
      startSessionCountdown();
      passwordForm.reset();
      passwordSuccess.textContent = 'Senha alterada.';
    } catch (error) {
      passwordError.textContent = describePasswordError(error);
    }
  }

  async function handleLogout() {
    stopSessionCountdown();
    const refreshToken = sessionStore.refreshToken;
    sessionStore.clear();
    try {
      if (refreshToken) {
        await api.logout(refreshToken);
      }
    } catch {
      // Sessão local já foi limpa; falha na revogação remota não impede o logout.
    }
    window.location.reload();
  }

  async function restoreSessionOrShowLogin() {
    sessionStore.load();
    if (!sessionStore.isLoggedIn()) {
      showLoginScreen();
      return;
    }

    try {
      const me = await api.authMe();
      if (!sessionStore.accessExpiresAtMs) {
        sessionStore.syncAccessExpiryFromToken();
      }
      // TEMP (versão de testes): pula cadastro/exigência de TOTP.
      if (TOTP_DISABLED || me.user.totpEnabled) {
        enterApp(me.user, me.subscription);
      } else {
        await openTotpSetup({ dismissible: false });
      }
    } catch (error) {
      sessionStore.clear();
      if (error?.code === 'DEMO_EXPIRED') {
        showDemoExpired({ detail: { message: error.message } });
      } else {
        showLoginScreen();
      }
    }
  }

  function showSubscriptionExpired() {
    formatSubscriptionBadge({ active: false }, sessionStore.user?.role || 'USER');
    window.alert('Sua assinatura expirou. Contate o administrador para renovar o acesso.');
  }

  loginForm.addEventListener('submit', handleLoginSubmit);
  totpPasswordForm.addEventListener('submit', handleTotpPasswordSubmit);
  totpSetupForm.addEventListener('submit', handleTotpSetupSubmit);
  elevateForm.addEventListener('submit', handleElevateSubmit);
  passwordForm.addEventListener('submit', handlePasswordSubmit);
  logoutButton.addEventListener('click', handleLogout);
  authenticatorButton.addEventListener('click', handleAuthenticatorClick);
  changePasswordButton.addEventListener('click', showPasswordModal);
  document
    .querySelectorAll('[data-elevate-dismiss]')
    .forEach((el) => el.addEventListener('click', () => hide(elevateModal)));
  document
    .querySelectorAll('[data-totp-dismiss]')
    .forEach((el) => el.addEventListener('click', dismissTotpSetup));
  document
    .querySelectorAll('[data-password-dismiss]')
    .forEach((el) => el.addEventListener('click', () => hide(passwordModal)));

  window.addEventListener('auth:elevation-required', showElevateModal);
  window.addEventListener('auth:subscription-expired', showSubscriptionExpired);
  window.addEventListener('auth:demo-expired', showDemoExpired);
  window.addEventListener('auth:logged-out', showLoginScreen);
  window.addEventListener('auth:session-refreshed', () => {
    startSessionCountdown();
  });

  restoreSessionOrShowLogin();
}

window.initAuthUi = initAuthUi;
