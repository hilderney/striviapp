const fs = require('fs/promises');
const path = require('path');
const { ScannerError } = require('../errors');

async function listPdfs(dirPath, options = {}) {
  if (dirPath == null) {
    throw new ScannerError('Directory path is required');
  }

  const { recursive = false, fsImpl = fs } = options;
  const absoluteDir = path.resolve(dirPath);

  let entries;
  try {
    entries = await fsImpl.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw new ScannerError(`Failed to read directory: ${absoluteDir}`, error);
  }

  const results = [];

  for (const entry of entries) {
    const entryPath = path.join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        const nested = await listPdfs(entryPath, { recursive: true, fsImpl });
        results.push(...nested);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!/\.pdf$/i.test(entry.name)) {
      continue;
    }

    const stats = await fsImpl.stat(entryPath);
    results.push({
      name: entry.name,
      path: path.resolve(entryPath),
      sizeBytes: stats.size,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  listPdfs,
};
