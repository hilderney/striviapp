const fs = require('fs/promises');
const path = require('path');
const { LogViewerError } = require('../errors');
const { isPathInside } = require('../utils/paths');

function assertValidLogFilename(filename) {
  const name = String(filename || '');
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new LogViewerError('Invalid log path', {
      statusCode: 400,
      code: 'INVALID_PATH',
    });
  }
  if (path.extname(name).toLowerCase() !== '.log') {
    throw new LogViewerError('Only .log files are allowed', {
      statusCode: 400,
      code: 'INVALID_EXTENSION',
    });
  }
  return name;
}

function resolveLogPath(logsDir, filename) {
  const name = assertValidLogFilename(filename);
  if (!isPathInside(logsDir, name)) {
    throw new LogViewerError('Invalid log path', {
      statusCode: 400,
      code: 'INVALID_PATH',
    });
  }
  return {
    name,
    filePath: path.join(path.resolve(logsDir), name),
  };
}

async function listLogs(logsDir, { search, sort = 'date', order = 'desc' } = {}) {
  const absoluteDir = path.resolve(logsDir);

  let entries;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const logs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) {
      continue;
    }
    const filePath = path.join(absoluteDir, entry.name);
    const stats = await fs.stat(filePath);
    logs.push({
      name: entry.name,
      path: filePath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }

  let filtered = logs;
  if (search) {
    const needle = String(search).toLowerCase();
    filtered = logs.filter((entry) => entry.name.toLowerCase().includes(needle));
  }

  const direction = order === 'asc' ? 1 : -1;
  filtered.sort((left, right) => {
    if (sort === 'name') {
      return left.name.localeCompare(right.name) * direction;
    }
    return left.modifiedAt.localeCompare(right.modifiedAt) * direction;
  });

  return filtered;
}

async function readLog(logsDir, filename) {
  const { name, filePath } = resolveLogPath(logsDir, filename);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { name, content };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new LogViewerError(`Log not found: ${name}`, {
        statusCode: 404,
        code: 'NOT_FOUND',
        cause: error,
      });
    }
    throw error;
  }
}

async function deleteLog(logsDir, filename) {
  const { name, filePath } = resolveLogPath(logsDir, filename);
  try {
    await fs.unlink(filePath);
    return { deleted: true, name };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new LogViewerError(`Log not found: ${name}`, {
        statusCode: 404,
        code: 'NOT_FOUND',
        cause: error,
      });
    }
    throw error;
  }
}

async function batchDeleteLogs(logsDir, filenames) {
  if (!Array.isArray(filenames) || filenames.length === 0) {
    throw new LogViewerError('files array is required', {
      statusCode: 400,
      code: 'INVALID_PATH',
    });
  }

  const resolved = filenames.map((filename) => resolveLogPath(logsDir, filename));

  let deleted = 0;
  for (const { filePath } of resolved) {
    try {
      await fs.unlink(filePath);
      deleted += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return {
    deleted,
    failed: [],
    files: resolved.map((entry) => entry.name),
  };
}

module.exports = {
  listLogs,
  readLog,
  deleteLog,
  batchDeleteLogs,
};
