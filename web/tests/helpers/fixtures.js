const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { PDFDocument, StandardFonts } = require('pdf-lib');

async function createValidPdfBuffer(text = 'Hello PDF') {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 50, y: 700, size: 24, font });
  return Buffer.from(await doc.save());
}

async function createTempDir(prefix = 'striviapp-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeMinimalPdf(dir, fileName = 'sample.pdf', text = 'Hello PDF') {
  const filePath = path.join(dir, fileName);
  const buffer = await createValidPdfBuffer(text);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function writeTextFile(dir, fileName, content) {
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

module.exports = {
  createValidPdfBuffer,
  createTempDir,
  writeMinimalPdf,
  writeTextFile,
};
