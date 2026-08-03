const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { ValidationError } = require('../errors');

function isPdfFile(name) {
  return path.extname(name).toLowerCase() === '.pdf';
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveBrowsePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new ValidationError('Path is required');
  }

  const resolved = path.resolve(inputPath.trim());
  return resolved;
}

async function getWindowsDrives() {
  const drives = [];

  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      fsSync.accessSync(drive);
      drives.push({
        name: drive,
        path: drive,
        type: 'drive',
      });
    } catch {
      // drive not available
    }
  }

  return drives;
}

async function getRoots() {
  const home = os.homedir();
  const cwd = process.cwd();
  const roots = [];

  if (process.platform === 'win32') {
    const drives = await getWindowsDrives();
    roots.push(...drives);
  } else {
    roots.push({ name: '/', path: '/', type: 'root' });
  }

  if (await pathExists(home)) {
    roots.push({ name: 'Home', path: home, type: 'home' });
  }

  if (await pathExists(cwd)) {
    roots.push({ name: 'Projeto', path: cwd, type: 'project' });
  }

  const fixtures = path.join(cwd, 'fixtures');
  if (await pathExists(fixtures)) {
    roots.push({ name: 'Fixtures', path: fixtures, type: 'fixtures' });
  }

  const defaultPath = (await pathExists(home)) ? home : cwd;

  return {
    roots: dedupeRoots(roots),
    defaultPath,
    platform: process.platform,
  };
}

function dedupeRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    const key = root.path.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function browse(inputPath) {
  const currentPath = resolveBrowsePath(inputPath);
  let stat;

  try {
    stat = await fs.stat(currentPath);
  } catch (error) {
    throw new ValidationError(`Path not found: ${currentPath}`, error);
  }

  if (!stat.isDirectory()) {
    throw new ValidationError(`Not a directory: ${currentPath}`);
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const directories = [];
  const pdfs = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      directories.push({
        name: entry.name,
        path: entryPath,
        type: 'directory',
      });
      continue;
    }

    if (entry.isFile() && isPdfFile(entry.name)) {
      let sizeBytes = 0;
      try {
        const fileStat = await fs.stat(entryPath);
        sizeBytes = fileStat.size;
      } catch {
        // ignore stat errors
      }

      pdfs.push({
        name: entry.name,
        path: entryPath,
        sizeBytes,
        type: 'pdf',
      });
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));
  pdfs.sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = path.dirname(currentPath);
  const hasParent = parentPath !== currentPath;

  return {
    currentPath,
    parentPath: hasParent ? parentPath : null,
    directories,
    pdfs,
    pdfCount: pdfs.length,
  };
}

module.exports = {
  getRoots,
  browse,
  resolveBrowsePath,
  isPdfFile,
};
