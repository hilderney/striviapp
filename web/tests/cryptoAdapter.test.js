const { encrypt, decrypt, deriveKey } = require('../src/adapters/cryptoAdapter');
const { CryptoError } = require('../src/errors');

const TEST_KEY = Buffer.alloc(32, 7).toString('hex');

describe('cryptoAdapter', () => {
  test('[F2-13] encrypt/decrypt deve ser reversível com mesma chave', () => {
    const token = 'sk-or-v1-test-token-12345';
    const encrypted = encrypt(token, { secret: TEST_KEY });
    const decrypted = decrypt(encrypted, { secret: TEST_KEY });
    expect(decrypted).toBe(token);
    expect(encrypted).not.toBe(token);
  });

  test('[F2-14] decrypt com chave errada deve lançar CryptoError', () => {
    const encrypted = encrypt('secret', { secret: TEST_KEY });
    const wrongKey = Buffer.alloc(32, 1).toString('hex');
    expect(() => decrypt(encrypted, { secret: wrongKey })).toThrow(CryptoError);
  });

  test('[F2-15] deve derivar chave de APP_SECRET_KEY env var', () => {
    const previous = process.env.APP_SECRET_KEY;
    process.env.APP_SECRET_KEY = TEST_KEY;

    try {
      const key = deriveKey(undefined, 'APP_SECRET_KEY');
      expect(key).toHaveLength(32);
      const encrypted = encrypt('via-env', { keyEnv: 'APP_SECRET_KEY' });
      expect(decrypt(encrypted, { keyEnv: 'APP_SECRET_KEY' })).toBe('via-env');
    } finally {
      if (previous === undefined) {
        delete process.env.APP_SECRET_KEY;
      } else {
        process.env.APP_SECRET_KEY = previous;
      }
    }
  });
});
