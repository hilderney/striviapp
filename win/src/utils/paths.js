const path = require('path');

function sanitizeBaseName(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildOutputBaseName(fileName, sourceSuffix) {
  const base = sanitizeBaseName(fileName);
  if (!sourceSuffix) {
    return base;
  }
  const suffix = String(sourceSuffix).replace(/^_/, '');
  if (base.endsWith(`_${suffix}`)) {
    return base;
  }
  return `${base}_${suffix}`;
}

function resolveAbsolute(filePath) {
  return path.resolve(filePath);
}

function isPathInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(baseDir, targetPath);
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

module.exports = {
  sanitizeBaseName,
  buildOutputBaseName,
  resolveAbsolute,
  isPathInside,
};
