const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadEnv } = require('../src/loadEnv');

describe('loadEnv', () => {
  test('deve carregar variáveis do arquivo .env', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-'));
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'LOAD_ENV_TEST_VALUE=hello-from-dotenv\n', 'utf8');

    const previous = process.env.LOAD_ENV_TEST_VALUE;
    delete process.env.LOAD_ENV_TEST_VALUE;

    try {
      loadEnv({ envPath });
      expect(process.env.LOAD_ENV_TEST_VALUE).toBe('hello-from-dotenv');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (previous === undefined) {
        delete process.env.LOAD_ENV_TEST_VALUE;
      } else {
        process.env.LOAD_ENV_TEST_VALUE = previous;
      }
    }
  });
});
