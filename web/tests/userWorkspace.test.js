const path = require('path');
const {
  OPEN_MODE_USER_ID,
  sanitizeUserIdForPath,
  resolveUserDir,
  resolveUserWorkspace,
} = require('../src/utils/userWorkspace');
const { AuthError } = require('../src/errors');

describe('userWorkspace', () => {
  test('sanitizeUserIdForPath aceita UUID e open-mode', () => {
    expect(sanitizeUserIdForPath('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    expect(sanitizeUserIdForPath(OPEN_MODE_USER_ID)).toBe(OPEN_MODE_USER_ID);
  });

  test('sanitizeUserIdForPath rejeita path traversal', () => {
    expect(() => sanitizeUserIdForPath('../etc')).toThrow(AuthError);
    expect(() => sanitizeUserIdForPath('a/b')).toThrow(AuthError);
    expect(() => sanitizeUserIdForPath('')).toThrow(AuthError);
  });

  test('resolveUserWorkspace isola output e staging por userId', () => {
    const ctx = { outputDir: './output', stagingDir: './staging' };
    const a = resolveUserWorkspace(ctx, { userId: 'user-a' });
    const b = resolveUserWorkspace(ctx, { userId: 'user-b' });

    expect(a.outputDir).toBe(path.resolve('output', 'user-a'));
    expect(a.stagingDir).toBe(path.resolve('staging', 'user-a'));
    expect(b.outputDir).not.toBe(a.outputDir);
    expect(resolveUserDir('./output', OPEN_MODE_USER_ID)).toBe(
      path.resolve('output', OPEN_MODE_USER_ID),
    );
  });

  test('sem auth usa OPEN_MODE_USER_ID', () => {
    const ws = resolveUserWorkspace({ outputDir: '/tmp/out', stagingDir: '/tmp/stg' }, null);
    expect(ws.userId).toBe(OPEN_MODE_USER_ID);
    expect(ws.outputDir).toBe(path.resolve('/tmp/out', OPEN_MODE_USER_ID));
  });
});
