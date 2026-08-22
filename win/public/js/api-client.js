const api = {
  _buildAuthHeaders() {
    const store = window.sessionStore;
    const headers = {};
    if (store?.accessToken) {
      headers.Authorization = `Bearer ${store.accessToken}`;
    }
    if (store?.elevationToken) {
      headers['X-Elevation-Token'] = store.elevationToken;
    }
    return headers;
  },

  async _rawRequest(path, options = {}, body = null) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this._buildAuthHeaders(),
        ...(options.headers || {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      const error = new Error(payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.code || null;
      error.payload = payload;
      throw error;
    }

    return payload;
  },

  // Sessão expirada é renovada uma vez de forma transparente; se o refresh
  // também falhar, o usuário é deslogado (evento tratado pelo auth-ui).
  // O refresh rotaciona e revoga o token antigo, então chamadas paralelas
  // precisam compartilhar uma única renovação em voo.
  _refreshInFlight: null,

  _tryRefreshSession() {
    if (!this._refreshInFlight) {
      this._refreshInFlight = this._performRefresh().finally(() => {
        this._refreshInFlight = null;
      });
    }
    return this._refreshInFlight;
  },

  async _performRefresh() {
    const store = window.sessionStore;
    if (!store?.refreshToken) {
      return false;
    }
    try {
      const renewed = await this._rawRequest('/api/v1/auth/refresh', { method: 'POST' }, {
        refreshToken: store.refreshToken,
      });
      store.saveSession({
        accessToken: renewed.accessToken,
        refreshToken: renewed.refreshToken,
        user: renewed.user,
        expiresInSeconds: renewed.expiresInSeconds,
      });
      window.dispatchEvent(
        new CustomEvent('auth:session-refreshed', {
          detail: { expiresInSeconds: renewed.expiresInSeconds },
        }),
      );
      return true;
    } catch {
      return false;
    }
  },

  async request(path, options = {}, body = null) {
    const isAuthRoute = path.startsWith('/api/v1/auth/login') || path.startsWith('/api/v1/auth/refresh');
    try {
      return await this._rawRequest(path, options, body);
    } catch (error) {
      if (error.status === 401 && !isAuthRoute) {
        if (await this._tryRefreshSession()) {
          return this._rawRequest(path, options, body);
        }
        window.sessionStore?.clear();
        window.dispatchEvent(new CustomEvent('auth:logged-out'));
      }
      if (error.status === 403 && error.code === 'ELEVATION_REQUIRED') {
        window.sessionStore?.clearElevation();
        window.dispatchEvent(new CustomEvent('auth:elevation-required'));
      }
      if (error.status === 403 && error.code === 'SUBSCRIPTION_EXPIRED') {
        window.dispatchEvent(new CustomEvent('auth:subscription-expired'));
      }
      if (error.status === 403 && error.code === 'DEMO_EXPIRED') {
        window.sessionStore?.clear();
        window.dispatchEvent(
          new CustomEvent('auth:demo-expired', {
            detail: { message: error.message },
          }),
        );
      }
      throw error;
    }
  },

  // Links <a href> (ex.: /open/arquivo.csv) não enviam headers — tokens vão na query.
  withAuthQuery(url) {
    const store = window.sessionStore;
    if (!store?.accessToken) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    const params = new URLSearchParams({ access_token: store.accessToken });
    if (store.elevationToken) {
      params.set('elevation_token', store.elevationToken);
    }
    return `${url}${separator}${params}`;
  },

  login(username, password) {
    return this.request('/api/v1/auth/login', { method: 'POST' }, { username, password });
  },

  logout(refreshToken) {
    return this.request('/api/v1/auth/logout', { method: 'POST' }, { refreshToken });
  },

  authMe() {
    return this.request('/api/v1/auth/me');
  },

  elevate(code) {
    return this.request('/api/v1/auth/elevate', { method: 'POST' }, { code });
  },

  // password só é exigido para trocar um authenticator já ativo.
  totpSetup(password = null) {
    return this.request(
      '/api/v1/auth/totp/setup',
      { method: 'POST' },
      password ? { password } : null,
    );
  },

  totpConfirm(code) {
    return this.request('/api/v1/auth/totp/confirm', { method: 'POST' }, { code });
  },

  changePassword(currentPassword, newPassword) {
    return this.request(
      '/api/v1/auth/password',
      { method: 'POST' },
      { currentPassword, newPassword },
    );
  },

  listFiles() {
    return this.request('/api/v1/files');
  },

  deleteFile(filename) {
    return this.request(`/api/v1/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  },

  fsRoots() {
    return this.request('/api/v1/fs/roots');
  },

  fsBrowse(targetPath) {
    const query = new URLSearchParams({ path: targetPath });
    return this.request(`/api/v1/fs/browse?${query}`);
  },

  stagePdfs(files) {
    return this.request('/api/v1/pipeline/stage', { method: 'POST' }, { files });
  },

  inputStage(files) {
    return this.request('/api/v1/input/stage', { method: 'POST' }, { files });
  },

  inputProcess(inputDir, files, outputDir) {
    return this.request('/api/v1/input/process', { method: 'POST' }, {
      inputDir,
      files,
      outputDir,
      overwrite: true,
    });
  },

  inputRun(files, processNames = null) {
    return this.request('/api/v1/input/run', { method: 'POST' }, {
      files,
      processNames,
      overwrite: true,
      formats: ['csv', 'xlsx'],
    });
  },

  pipelineScan(inputDir, recursive = false) {
    return this.request('/api/v1/pipeline/scan', { method: 'POST' }, { inputDir, recursive });
  },

  pipelineRun(inputDir, outputDir) {
    return this.request('/api/v1/pipeline/run', { method: 'POST' }, {
      inputDir,
      outputDir,
      overwrite: true,
      formats: ['csv', 'xlsx'],
    });
  },

  spreadsheetScan(inputDir, recursive = false) {
    return this.request('/api/v1/spreadsheet/scan', { method: 'POST' }, { inputDir, recursive });
  },

  spreadsheetImport(sourceFile, inputDir) {
    return this.request('/api/v1/spreadsheet/import', { method: 'POST' }, {
      sourceFile,
      inputDir,
      overwrite: true,
      formats: ['csv', 'xlsx'],
    });
  },

  listModels() {
    return this.request('/api/v1/llm/models');
  },

  createModel(data) {
    return this.request('/api/v1/llm/models', { method: 'POST' }, data);
  },

  updateModel(id, data) {
    return this.request(`/api/v1/llm/models/${id}`, { method: 'PUT' }, data);
  },

  deleteModel(id) {
    return this.request(`/api/v1/llm/models/${id}`, { method: 'DELETE' });
  },

  healthCheck(id) {
    return this.request(`/api/v1/llm/models/${id}/health`, { method: 'POST' });
  },

  processLlm(data) {
    return this.request('/api/v1/llm/process', { method: 'POST' }, data);
  },

  listLogs(params = {}) {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    if (params.order) query.set('order', params.order);
    const qs = query.toString();
    return this.request(`/api/v1/logs${qs ? `?${qs}` : ''}`);
  },

  readLog(filename) {
    return this.request(`/api/v1/logs/${encodeURIComponent(filename)}`);
  },

  deleteLog(filename) {
    return this.request(`/api/v1/logs/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  },

  deleteLogsBatch(filenames) {
    return this.request('/api/v1/logs/batch-delete', { method: 'POST' }, { files: filenames });
  },
};

window.api = api;
