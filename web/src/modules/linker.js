const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { LinkerError } = require('../errors');
const { isPathInside } = require('../utils/paths');

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
};

function getContentType(fileName) {
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] || 'application/octet-stream';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function listOutputFiles(outputDir, baseUrl) {
  const absoluteOutputDir = path.resolve(outputDir);

  let entries;
  try {
    entries = await fs.readdir(absoluteOutputDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      type: getContentType(entry.name),
      url: `${baseUrl}/open/${encodeURIComponent(entry.name)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function deleteOutputFile(outputDir, fileName) {
  if (!isPathInside(outputDir, fileName)) {
    throw new LinkerError('Invalid file path');
  }

  // Apaga exatamente o caminho validado: usar basename aqui faria "sub/a.csv"
  // passar na validação e remover "a.csv" na raiz do output.
  const filePath = path.join(path.resolve(outputDir), fileName);
  const name = path.basename(fileName);

  try {
    await fs.unlink(filePath);
    return { deleted: true, name };
  } catch (error) {
    if (error.code === 'ENOENT') {
      const notFound = new LinkerError(`File not found: ${fileName}`);
      notFound.statusCode = 404;
      throw notFound;
    }
    throw new LinkerError(`Failed to delete file: ${fileName}`, error);
  }
}

function createRequestHandler(outputDir, baseUrl) {
  const absoluteOutputDir = path.resolve(outputDir);
  // baseUrl pode ser função: com porta efêmera (port: 0) a URL real só existe
  // após listen(), então precisa ser resolvida a cada uso.
  const resolveBaseUrl = typeof baseUrl === 'function' ? baseUrl : () => baseUrl;

  return async (req, res) => {
    try {
      const url = new URL(req.url, resolveBaseUrl());

      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      if (url.pathname === '/files') {
        const files = await listOutputFiles(absoluteOutputDir, resolveBaseUrl());
        return sendJson(res, 200, { files });
      }

      const openMatch = url.pathname.match(/^\/open\/(.+)$/);
      if (openMatch) {
        const requestedName = decodeURIComponent(openMatch[1]);

        if (!isPathInside(absoluteOutputDir, requestedName)) {
          return sendJson(res, 400, { error: 'Invalid file path' });
        }

        const filePath = path.join(absoluteOutputDir, requestedName);

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

      return sendJson(res, 404, { error: 'Route not found' });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  };
}

async function createServer(options = {}) {
  const {
    port = 4000,
    outputDir = './output',
    host = '127.0.0.1',
    httpImpl = http,
  } = options;

  let listeningPort = port;
  const handler = createRequestHandler(outputDir, () => `http://${host}:${listeningPort}`);

  const server = httpImpl.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      sendJson(res, 500, { error: error.message });
    });
  });

  listeningPort = await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(new LinkerError(`Failed to start server on port ${port}`, error));
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
            reject(new LinkerError('Failed to close server', error));
            return;
          }
          resolve();
        });
      }),
  };
}

module.exports = {
  createServer,
  getContentType,
  listOutputFiles,
  deleteOutputFile,
};
