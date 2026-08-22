const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { LinkerError } = require('../errors');
const { isPathInside } = require('../utils/paths');
const { listOutputFiles, getContentType, deleteOutputFile } = require('./linker');
const { getRoots, browse } = require('./fsBrowser');
const { stagePdfFiles, stageInputFiles } = require('./stagingUpload');
const { processInputFiles } = require('./inputProcessService');
const { importSpreadsheet, listSpreadsheets } = require('./spreadsheetImporter');
const { listLogs, readLog, deleteLog, batchDeleteLogs } = require('./logViewerService');
const { createAuthGuard } = require('./authGuard');
const { resolveUserWorkspace, OPEN_MODE_USER_ID } = require('../utils/userWorkspace');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const DEFAULT_FORMATS = ['csv', 'xlsx'];

// Uploads chegam como base64 dentro do JSON, então o teto precisa acomodar
// MAX_TOTAL_BYTES (200MB) inflado em 4/3 mais o overhead do envelope.
const MAX_JSON_BODY_BYTES = 300 * 1024 * 1024;

// Returned by route handlers that matched the path but not the HTTP method,
// so the main dispatcher keeps trying later routes (preserving fall-through).
const NOT_HANDLED = Symbol('route-not-handled');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
  });
}

async function readJsonBody(req, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  const chunks = [];
  let received = 0;

  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBytes) {
      req.destroy();
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

async function serveStaticFile(res, staticDir, relativePath) {
  const safePath = relativePath.replace(/^\/+/, '');
  if (!isPathInside(staticDir, safePath)) {
    return sendJson(res, 400, { error: 'Invalid static path' });
  }

  const filePath = path.join(path.resolve(staticDir), safePath);

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    return res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(res, 404, { error: 'File not found' });
    }
    throw error;
  }
}

async function serveOutputFile(res, outputDir, requestedName) {
  if (!isPathInside(outputDir, requestedName)) {
    return sendJson(res, 400, { error: 'Invalid file path' });
  }

  const filePath = path.join(path.resolve(outputDir), requestedName);

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(requestedName),
      'Content-Disposition': `inline; filename="${path.basename(requestedName)}"`,
    });
    return res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(res, 404, { error: 'File not found' });
    }
    throw error;
  }
}

function createPipelineController(phase1Api, config) {
  const { PdfSummarizerBuilder } = phase1Api;

  return {
    async scan(body) {
      const pdfs = await phase1Api.listPdfs(body.inputDir, { recursive: Boolean(body.recursive) });
      return { pdfs };
    },

    async extract(body) {
      const outputDir = body.outputDir || config.outputDir;
      return phase1Api.extractBatch(body.pdfPaths || [], outputDir, {
        overwrite: Boolean(body.overwrite),
      });
    },

    async export(body) {
      const outputDir = body.outputDir || config.outputDir;
      const formats = body.formats || DEFAULT_FORMATS;
      const results = body.results || [];
      const exports = { csv: [], xlsx: [] };

      if (formats.includes('csv')) {
        for (const result of results) {
          exports.csv.push(await phase1Api.exportCsv([result], outputDir));
        }
      }

      if (formats.some((format) => ['xlsx', 'xls', 'excel'].includes(format))) {
        for (const result of results) {
          exports.xlsx.push(await phase1Api.exportXlsx([result], outputDir));
        }
      }

      return { exports };
    },

    async run(body) {
      const pipeline = PdfSummarizerBuilder.create()
        .fromDirectory(body.inputDir)
        .outputTo(body.outputDir || config.outputDir)
        .withLogs(body.logsDir || config.logsDir)
        .recursive(Boolean(body.recursive))
        .overwrite(body.overwrite !== false)
        .exportFormats(body.formats || DEFAULT_FORMATS)
        .withoutServer()
        .build();

      const summary = await pipeline.run();
      await pipeline.close();
      return summary;
    },
  };
}

async function handleDeleteFile(ctx, res, requestedName, auth) {
  const { outputDir } = resolveUserWorkspace(ctx, auth);
  try {
    const result = await deleteOutputFile(outputDir, requestedName);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

async function handleFsBrowse(res, url) {
  const targetPath = url.searchParams.get('path');
  if (!targetPath) {
    return sendJson(res, 400, { error: 'path query parameter is required' });
  }
  return sendJson(res, 200, await browse(targetPath));
}

async function handleInputStage(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return sendJson(res, 400, { error: 'files array is required' });
  }
  const { stagingDir } = resolveUserWorkspace(ctx, auth);
  const staged = await stageInputFiles(body.files, stagingDir);
  return sendJson(res, 201, staged);
}

async function handleInputProcess(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  if (!body.inputDir || !Array.isArray(body.files) || body.files.length === 0) {
    return sendJson(res, 400, { error: 'inputDir and files are required' });
  }

  const { stagingDir, outputDir } = resolveUserWorkspace(ctx, auth);
  const resolvedInput = path.resolve(body.inputDir);
  const resolvedStaging = path.resolve(stagingDir);
  if (
    resolvedInput !== resolvedStaging &&
    !resolvedInput.startsWith(resolvedStaging + path.sep)
  ) {
    return sendJson(res, 403, {
      error: 'inputDir outside user workspace',
      code: 'WORKSPACE_FORBIDDEN',
    });
  }

  for (const fileName of body.files) {
    if (!isPathInside(body.inputDir, fileName)) {
      return sendJson(res, 400, { error: 'Invalid file path' });
    }
  }

  const summary = await processInputFiles(body.inputDir, body.files, {
    outputDir,
    logsDir: body.logsDir || ctx.logsDir,
    phase1Api: ctx.phase1Api,
    baseUrl: ctx.baseUrl,
    overwrite: body.overwrite !== false,
  });
  return sendJson(res, 200, summary);
}

async function handleInputRun(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return sendJson(res, 400, { error: 'files array is required' });
  }

  const { stagingDir, outputDir } = resolveUserWorkspace(ctx, auth);
  const staged = await stageInputFiles(body.files, stagingDir);
  const fileNames = body.processNames?.length
    ? body.processNames.filter((name) => staged.files.some((file) => file.name === name))
    : staged.files.map((file) => file.name);

  const summary = await processInputFiles(staged.inputDir, fileNames, {
    outputDir,
    logsDir: body.logsDir || ctx.logsDir,
    phase1Api: ctx.phase1Api,
    baseUrl: ctx.baseUrl,
    overwrite: body.overwrite !== false,
  });

  return sendJson(res, 201, { ...summary, staged });
}

async function handleSpreadsheetScan(ctx, req, res) {
  const body = await readJsonBody(req);
  const files = await listSpreadsheets(body.inputDir || ctx.inputDir, {
    recursive: Boolean(body.recursive),
  });
  return sendJson(res, 200, { files });
}

async function handleSpreadsheetImport(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  if (!body.sourceFile) {
    return sendJson(res, 400, { error: 'sourceFile is required' });
  }

  const { outputDir } = resolveUserWorkspace(ctx, auth);
  const targetInputDir = body.inputDir || ctx.inputDir;
  if (!isPathInside(targetInputDir, body.sourceFile)) {
    return sendJson(res, 400, { error: 'Invalid file path' });
  }

  try {
    const result = await importSpreadsheet(body.sourceFile, {
      inputDir: targetInputDir,
      outputDir,
      formats: body.formats || DEFAULT_FORMATS,
      overwrite: body.overwrite !== false,
      logsDir: body.logsDir || ctx.logsDir,
      baseUrl: ctx.baseUrl,
    });
    return sendJson(res, 201, result);
  } catch (error) {
    if (error.code === 'NOT_FOUND' || error.cause?.code === 'ENOENT') {
      return sendJson(res, 404, { error: error.message });
    }
    throw error;
  }
}

async function handleListLogs(ctx, res, url) {
  const logs = await listLogs(ctx.logsDir, {
    search: url.searchParams.get('search') || undefined,
    sort: url.searchParams.get('sort') || 'date',
    order: url.searchParams.get('order') || 'desc',
  });
  return sendJson(res, 200, { logs });
}

async function handleReadLog(ctx, res, filename) {
  try {
    const result = await readLog(ctx.logsDir, filename);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

async function handleDeleteLog(ctx, res, filename) {
  try {
    const result = await deleteLog(ctx.logsDir, filename);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

async function handleBatchDeleteLogs(ctx, req, res) {
  const body = await readJsonBody(req);
  try {
    const result = await batchDeleteLogs(ctx.logsDir, body.files);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

async function handlePipelineAction(ctx, req, res, pathname, auth) {
  const body = await readJsonBody(req);
  const action = pathname.replace('/api/v1/pipeline/', '');
  const runner = ctx.pipeline[action];
  const { outputDir } = resolveUserWorkspace(ctx, auth);

  if (!runner || !['scan', 'extract', 'export', 'run'].includes(action)) {
    return sendJson(res, 404, { error: 'Unknown pipeline action' });
  }

  // Ignora outputDir do client — sempre o workspace do usuário autenticado.
  return sendJson(res, 200, await runner({ ...body, outputDir }));
}

async function handleModelRoute(ctx, req, res, modelMatch, auth) {
  const modelId = modelMatch[1];
  const isHealth = modelMatch[2] === 'health';
  // Sem authService (testes F1–4) usa um tenant local fixo.
  const userId = auth?.userId ?? OPEN_MODE_USER_ID;

  if (isHealth && req.method === 'POST') {
    return sendJson(res, 200, await ctx.llmModelService.healthCheck(modelId, userId));
  }

  if (req.method === 'GET') {
    const model = await ctx.llmModelService.get(modelId, userId);
    return model
      ? sendJson(res, 200, model)
      : sendJson(res, 404, { error: 'Model not found' });
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req);
    const model = await ctx.llmModelService.update(modelId, body, userId);
    return model
      ? sendJson(res, 200, model)
      : sendJson(res, 404, { error: 'Model not found' });
  }

  if (req.method === 'DELETE') {
    try {
      const deleted = await ctx.llmModelService.remove(modelId, userId);
      if (!deleted) {
        return sendJson(res, 404, { error: 'Model not found' });
      }
      res.writeHead(204);
      return res.end();
    } catch (error) {
      return sendJson(res, error.statusCode || 500, { error: error.message });
    }
  }

  return NOT_HANDLED;
}

async function handleAuthLogin(ctx, req, res) {
  const body = await readJsonBody(req);
  return sendJson(res, 200, await ctx.authService.login(body));
}

async function handleAuthRefresh(ctx, req, res) {
  const body = await readJsonBody(req);
  return sendJson(res, 200, await ctx.authService.refresh(body));
}

async function handleAuthLogout(ctx, req, res) {
  const body = await readJsonBody(req);
  return sendJson(res, 200, await ctx.authService.logout(body));
}

async function handleAuthMe(ctx, req, res, auth) {
  const user = await ctx.authService.getUser(auth.userId);
  const subscription = ctx.authService.getSubscriptionInfo(user);

  let elevated = false;
  let elevationExpiresAt = null;
  const elevationToken = req.headers['x-elevation-token'];
  if (elevationToken) {
    try {
      const claims = ctx.authService.verifyElevationToken(elevationToken, auth.userId);
      elevated = true;
      elevationExpiresAt = new Date(claims.exp * 1000).toISOString();
    } catch {
      elevated = false;
    }
  }

  return sendJson(res, 200, {
    user,
    elevated,
    elevationExpiresAt,
    subscription,
    accessTtlSeconds: ctx.authService.getAccessTtlSeconds(),
  });
}

async function handleAuthElevate(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  return sendJson(res, 200, await ctx.authService.elevate(auth.userId, body.code));
}

async function handleAuthTotpSetup(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  return sendJson(res, 200, await ctx.authService.setupTotp(auth.userId, { password: body.password }));
}

async function handleAuthTotpConfirm(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  return sendJson(res, 200, await ctx.authService.confirmTotp(auth.userId, body.code));
}

async function handleAuthUsers(ctx, req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { users: await ctx.authService.listUsers() });
  }
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 201, await ctx.authService.createUser(body));
  }
  return NOT_HANDLED;
}

async function handleAuthUserSubscription(ctx, req, res, userId) {
  if (req.method !== 'PATCH' && req.method !== 'PUT') {
    return NOT_HANDLED;
  }
  const body = await readJsonBody(req);
  if (body.months != null) {
    return sendJson(
      res,
      200,
      await ctx.authService.renewSubscription(userId, {
        months: Number(body.months) || 1,
        plan: body.plan,
      }),
    );
  }
  return sendJson(
    res,
    200,
    await ctx.authService.updateSubscription(userId, {
      expiresAt: body.expiresAt,
      plan: body.plan,
      status: body.status,
    }),
  );
}

function routeAuthRequest(ctx, req, res, pathname, auth) {
  if (!ctx.authService) {
    return sendJson(res, 404, { error: 'Authentication is not enabled' });
  }

  const isPost = req.method === 'POST';

  if (isPost && pathname === '/api/v1/auth/login') {
    return handleAuthLogin(ctx, req, res);
  }
  if (isPost && pathname === '/api/v1/auth/refresh') {
    return handleAuthRefresh(ctx, req, res);
  }
  if (isPost && pathname === '/api/v1/auth/logout') {
    return handleAuthLogout(ctx, req, res);
  }
  if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
    return handleAuthMe(ctx, req, res, auth);
  }
  if (isPost && pathname === '/api/v1/auth/elevate') {
    return handleAuthElevate(ctx, req, res, auth);
  }
  if (isPost && pathname === '/api/v1/auth/totp/setup') {
    return handleAuthTotpSetup(ctx, req, res, auth);
  }
  if (isPost && pathname === '/api/v1/auth/totp/confirm') {
    return handleAuthTotpConfirm(ctx, req, res, auth);
  }

  const subscriptionMatch = pathname.match(/^\/api\/v1\/auth\/users\/([^/]+)\/subscription$/);
  if (subscriptionMatch) {
    return Promise.resolve(
      handleAuthUserSubscription(ctx, req, res, decodeURIComponent(subscriptionMatch[1])),
    ).then((result) =>
      result === NOT_HANDLED ? sendJson(res, 404, { error: 'Route not found' }) : result,
    );
  }

  if (pathname === '/api/v1/auth/users') {
    return Promise.resolve(handleAuthUsers(ctx, req, res)).then((result) =>
      result === NOT_HANDLED ? sendJson(res, 404, { error: 'Route not found' }) : result,
    );
  }

  return sendJson(res, 404, { error: 'Route not found' });
}

async function handleLlmProcess(ctx, req, res, auth) {
  const body = await readJsonBody(req);
  const { outputDir, userId } = resolveUserWorkspace(ctx, auth);
  try {
    const result = await ctx.llmProcessService.processRequest({
      ...body,
      userId: auth?.userId ?? userId,
      outputDir,
    });
    return sendJson(res, 201, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 502, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

function routeRequest(ctx, req, res, url, auth) {
  const { pathname } = url;
  const isGet = req.method === 'GET';
  const isPost = req.method === 'POST';

  if (pathname.startsWith('/api/v1/auth/')) {
    return routeAuthRequest(ctx, req, res, pathname, auth);
  }

  if (isGet && pathname === '/') {
    return serveStaticFile(res, ctx.staticDir, 'index.html');
  }

  if (
    isGet &&
    (pathname.startsWith('/css/') ||
      pathname.startsWith('/js/') ||
      pathname.startsWith('/assets/') ||
      pathname === '/favicon.ico' ||
      pathname === '/favicon.png')
  ) {
    return serveStaticFile(res, ctx.staticDir, pathname.slice(1));
  }

  if (isGet && pathname === '/api/v1/files') {
    const { outputDir } = resolveUserWorkspace(ctx, auth);
    return listOutputFiles(outputDir, ctx.baseUrl).then((files) => sendJson(res, 200, { files }));
  }

  const deleteFileMatch = pathname.match(/^\/api\/v1\/files\/(.+)$/);
  if (req.method === 'DELETE' && deleteFileMatch) {
    return handleDeleteFile(ctx, res, decodeURIComponent(deleteFileMatch[1]), auth);
  }

  if (isGet && pathname === '/api/v1/fs/roots') {
    return getRoots().then((roots) => sendJson(res, 200, roots));
  }

  if (isGet && pathname === '/api/v1/fs/browse') {
    return handleFsBrowse(res, url);
  }

  if (isPost && pathname === '/api/v1/pipeline/stage') {
    const { stagingDir } = resolveUserWorkspace(ctx, auth);
    return readJsonBody(req).then((body) =>
      stagePdfFiles(body.files, stagingDir).then((staged) => sendJson(res, 201, staged)),
    );
  }

  const openMatch = pathname.match(/^\/open\/(.+)$/);
  if (isGet && openMatch) {
    const { outputDir } = resolveUserWorkspace(ctx, auth);
    return serveOutputFile(res, outputDir, decodeURIComponent(openMatch[1]));
  }

  if (isPost && pathname === '/api/v1/input/stage') {
    return handleInputStage(ctx, req, res, auth);
  }

  if (isPost && pathname === '/api/v1/input/process') {
    return handleInputProcess(ctx, req, res, auth);
  }

  if (isPost && pathname === '/api/v1/input/run') {
    return handleInputRun(ctx, req, res, auth);
  }

  if (isPost && pathname === '/api/v1/spreadsheet/scan') {
    return handleSpreadsheetScan(ctx, req, res);
  }

  if (isPost && pathname === '/api/v1/spreadsheet/import') {
    return handleSpreadsheetImport(ctx, req, res, auth);
  }

  if (isGet && pathname === '/api/v1/logs') {
    return handleListLogs(ctx, res, url);
  }

  if (isPost && pathname === '/api/v1/logs/batch-delete') {
    return handleBatchDeleteLogs(ctx, req, res);
  }

  const logMatch = pathname.match(/^\/api\/v1\/logs\/(.+)$/);
  if (logMatch) {
    const filename = decodeURIComponent(logMatch[1]);
    if (isGet) {
      return handleReadLog(ctx, res, filename);
    }
    if (req.method === 'DELETE') {
      return handleDeleteLog(ctx, res, filename);
    }
  }

  if (isPost && pathname.startsWith('/api/v1/pipeline/')) {
    return handlePipelineAction(ctx, req, res, pathname, auth);
  }

  if (isGet && pathname === '/api/v1/llm/models') {
    const provider = url.searchParams.get('provider') || undefined;
    const userId = auth?.userId ?? OPEN_MODE_USER_ID;
    return ctx.llmModelService
      .list(provider ? { provider } : {}, userId)
      .then((models) => sendJson(res, 200, { models }));
  }

  if (isPost && pathname === '/api/v1/llm/models') {
    const userId = auth?.userId ?? OPEN_MODE_USER_ID;
    return readJsonBody(req)
      .then((body) => ctx.llmModelService.create(body, userId))
      .then((model) => sendJson(res, 201, model));
  }

  const modelMatch = pathname.match(/^\/api\/v1\/llm\/models\/([^/]+)(?:\/(health))?$/);
  if (modelMatch) {
    return handleModelRoute(ctx, req, res, modelMatch, auth).then((result) =>
      result === NOT_HANDLED ? sendJson(res, 404, { error: 'Route not found' }) : result,
    );
  }

  if (isPost && pathname === '/api/v1/llm/process') {
    return handleLlmProcess(ctx, req, res, auth);
  }

  if (isGet && pathname === '/api/v1/llm/jobs') {
    const userId = auth?.userId ?? OPEN_MODE_USER_ID;
    return ctx.llmProcessService.listJobs({}, userId).then((jobs) =>
      sendJson(res, 200, { jobs }),
    );
  }

  const jobMatch = pathname.match(/^\/api\/v1\/llm\/jobs\/([^/]+)$/);
  if (isGet && jobMatch) {
    const userId = auth?.userId ?? OPEN_MODE_USER_ID;
    return ctx.llmProcessService.getJob(jobMatch[1], userId).then((job) =>
      job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'Job not found' }),
    );
  }

  return sendJson(res, 404, { error: 'Route not found' });
}

function createAppRequestHandler(options) {
  const {
    outputDir,
    staticDir,
    baseUrl,
    phase1Api,
    llmModelService,
    llmProcessService,
    authService = null,
    logsDir = './logs',
    stagingDir = './staging',
    inputDir = process.env.INPUT_DIR || './input',
  } = options;

  const pipeline = createPipelineController(phase1Api, { outputDir, logsDir });
  // Sem authService (testes unitários das fases 1-4) o servidor opera aberto;
  // o LlmSummarizerBuilder sempre injeta authService em produção.
  const authGuard = authService ? createAuthGuard({ authService }) : null;
  // baseUrl pode ser função: com porta efêmera (port: 0) a URL real só existe
  // após listen(), então precisa ser resolvida a cada uso.
  const resolveBaseUrl = typeof baseUrl === 'function' ? baseUrl : () => baseUrl;
  const ctx = {
    outputDir,
    staticDir,
    phase1Api,
    llmModelService,
    llmProcessService,
    authService,
    logsDir,
    stagingDir,
    inputDir,
    pipeline,
  };
  Object.defineProperty(ctx, 'baseUrl', { enumerable: true, get: resolveBaseUrl });

  return async (req, res) => {
    try {
      const url = new URL(req.url, resolveBaseUrl());
      const auth = authGuard ? await authGuard.enforce(req, url, url.pathname) : null;
      return await routeRequest(ctx, req, res, url, auth);
    } catch (error) {
      return sendError(res, error);
    }
  };
}

async function createAppServer(options = {}) {
  const {
    port = 4000,
    host = '127.0.0.1',
    outputDir = './output',
    staticDir = './public',
    logsDir = './logs',
    stagingDir = './staging',
    inputDir = process.env.INPUT_DIR || './input',
    phase1Api,
    llmModelService,
    llmProcessService,
    authService = null,
    httpImpl = http,
  } = options;

  if (!phase1Api || !llmModelService || !llmProcessService) {
    throw new LinkerError('phase1Api, llmModelService and llmProcessService are required');
  }

  let listeningPort = port;
  const handler = createAppRequestHandler({
    outputDir,
    staticDir,
    baseUrl: () => `http://${host}:${listeningPort}`,
    phase1Api,
    llmModelService,
    llmProcessService,
    authService,
    logsDir,
    stagingDir,
    inputDir,
  });

  const server = httpImpl.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      sendJson(res, 500, { error: error.message });
    });
  });

  listeningPort = await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(new LinkerError(`Failed to start app server on port ${port}`, error));
    });
    server.listen(port, host, () => {
      const address = server.address();
      resolve(typeof address === 'object' ? address.port : port);
    });
  });

  const resolvedUrl = `http://${host}:${listeningPort}`;

  return {
    url: resolvedUrl,
    port: listeningPort,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(new LinkerError('Failed to close app server', error));
            return;
          }
          resolve();
        });
      }),
  };
}

module.exports = {
  createAppServer,
  createAppRequestHandler,
  readJsonBody,
  MAX_JSON_BODY_BYTES,
};
