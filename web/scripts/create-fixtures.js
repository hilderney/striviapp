const fs = require('fs/promises');
const path = require('path');
const { createValidPdfBuffer } = require('../tests/helpers/fixtures');

async function ensureFixtures() {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const buffer = await createValidPdfBuffer('Hello PDF');
  await fs.mkdir(fixturesDir, { recursive: true });
  await fs.writeFile(path.join(fixturesDir, 'sample.pdf'), buffer);
  await fs.writeFile(path.join(fixturesDir, 'sample-empty.pdf'), buffer);
}

ensureFixtures().catch((error) => {
  console.error('Failed to create fixtures:', error.message);
  process.exit(1);
});
