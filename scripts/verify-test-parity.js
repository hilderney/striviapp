'use strict';

/**
 * Verifica se os IDs/arquivos exigidos pelo tests-manifest.json estão
 * presentes na suíte do produto (--product web|win).
 *
 * Só falha por ausência: um teste a mais nunca quebra o build.
 *
 * Também compara o hash SHA-256 dos arquivos de teste presentes nos
 * dois produtos: se o mesmo nome existe em web/ e win/ com conteúdo
 * diferente, falha (detecta drift de cópia).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'tests-manifest.json');
const PRODUCTS = ['web', 'win'];

const ID_BRACKET = /\[((?:F\d+|RED)-\d+)\]/g;
const ID_RANGE = /\(((?:F\d+|RED)-\d+)\.\.((?:F\d+|RED)-\d+)\)/g;
const ID_SINGLE_PAREN = /\(((?:F\d+|RED)-\d+)\)/g;

function parseArgs(argv) {
  const idx = argv.indexOf('--product');
  const product = idx >= 0 ? argv[idx + 1] : null;
  if (product !== 'web' && product !== 'win') {
    console.error('Usage: node scripts/verify-test-parity.js --product <web|win>');
    process.exit(2);
  }
  return { product };
}

function expandRange(startId, endId) {
  const start = startId.match(/^(F\d+|RED)-(\d+)$/);
  const end = endId.match(/^(F\d+|RED)-(\d+)$/);
  if (!start || !end || start[1] !== end[1]) {
    throw new Error(`Invalid ID range: ${startId}..${endId}`);
  }
  const prefix = start[1];
  const from = Number(start[2]);
  const to = Number(end[2]);
  const ids = [];
  for (let n = from; n <= to; n += 1) {
    ids.push(`${prefix}-${String(n).padStart(2, '0')}`);
  }
  return ids;
}

function extractIds(content) {
  const ids = new Set();
  let match;

  const brackets = new RegExp(ID_BRACKET.source, 'g');
  while ((match = brackets.exec(content))) {
    ids.add(match[1]);
  }

  const ranges = new RegExp(ID_RANGE.source, 'g');
  while ((match = ranges.exec(content))) {
    for (const id of expandRange(match[1], match[2])) {
      ids.add(id);
    }
  }

  const singles = new RegExp(ID_SINGLE_PAREN.source, 'g');
  while ((match = singles.exec(content))) {
    const after = content.slice(match.index + match[0].length, match.index + match[0].length + 2);
    if (after === '..') {
      continue;
    }
    ids.add(match[1]);
  }

  return ids;
}

function listTestFiles(productDir) {
  const testsDir = path.join(productDir, 'tests');
  if (!fs.existsSync(testsDir)) {
    return [];
  }
  return fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(testsDir, name));
}

function collectProductIds(productDir) {
  const found = new Set();
  for (const filePath of listTestFiles(productDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const id of extractIds(content)) {
      found.add(id);
    }
  }
  return found;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listSharedTestBasenames() {
  const byProduct = {};
  for (const product of PRODUCTS) {
    const names = new Set(
      listTestFiles(path.join(ROOT, product)).map((filePath) => path.basename(filePath)),
    );
    byProduct[product] = names;
  }
  return [...byProduct.web].filter((name) => byProduct.win.has(name)).sort();
}

function findDivergentSharedTests() {
  const divergent = [];
  for (const name of listSharedTestBasenames()) {
    const webPath = path.join(ROOT, 'web', 'tests', name);
    const winPath = path.join(ROOT, 'win', 'tests', name);
    if (sha256File(webPath) !== sha256File(winPath)) {
      divergent.push(`tests/${name}`);
    }
  }
  return divergent;
}

function main() {
  const { product } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const productDir = path.join(ROOT, product);
  const foundIds = collectProductIds(productDir);

  const missingIds = [];
  const extras = [];

  for (const entry of manifest.cases) {
    if (entry.status !== 'implemented') {
      continue;
    }
    if (!entry.required.includes(product)) {
      continue;
    }
    if (!foundIds.has(entry.id)) {
      const loc = entry.files ? entry.files.join(', ') : entry.file;
      missingIds.push(`${entry.id}${loc ? ` (esperado em ${loc})` : ''}`);
    }
  }

  for (const id of [...foundIds].sort()) {
    const entry = manifest.cases.find((c) => c.id === id);
    if (!entry) {
      extras.push(id);
    }
  }

  const missingFiles = [];
  for (const entry of manifest.files || []) {
    if (!entry.required.includes(product)) {
      continue;
    }
    const abs = path.join(productDir, entry.path);
    if (!fs.existsSync(abs)) {
      missingFiles.push(entry.path);
    }
  }

  const divergentFiles = findDivergentSharedTests();

  if (extras.length) {
    console.log(`[verify-test-parity] ${product}: IDs extras (ok): ${extras.join(', ')}`);
  }

  if (missingIds.length || missingFiles.length || divergentFiles.length) {
    console.error(`[verify-test-parity] ${product}: falha de paridade`);
    if (missingIds.length) {
      console.error(`  IDs implementados ausentes (${missingIds.length}):`);
      for (const line of missingIds) {
        console.error(`    - ${line}`);
      }
    }
    if (missingFiles.length) {
      console.error(`  Arquivos obrigatórios ausentes (${missingFiles.length}):`);
      for (const file of missingFiles) {
        console.error(`    - ${file}`);
      }
    }
    if (divergentFiles.length) {
      console.error(
        `  Arquivos compartilhados com conteúdo divergente (${divergentFiles.length}):`,
      );
      for (const file of divergentFiles) {
        console.error(`    - ${file}`);
      }
    }
    process.exit(1);
  }

  const sharedCount = listSharedTestBasenames().length;
  console.log(
    `[verify-test-parity] ${product}: ok (${foundIds.size} IDs encontrados, ` +
      `${sharedCount} arquivos compartilhados idênticos, manifesto em dia)`,
  );
}

main();
