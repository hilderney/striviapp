const fs = require('fs/promises');
const path = require('path');
const { createLogger, createSessionId } = require('../src/modules/logger');
const { createTempDir } = require('./helpers/fixtures');

describe('logger', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('logger-test-');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('[RED-37] deve criar instância com nome de sessão único (timestamp + uuid curto)', () => {
    const sessionA = createSessionId();
    const sessionB = createSessionId();

    expect(sessionA).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sessionB).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sessionA).not.toBe(sessionB);
  });

  test('[RED-38] deve logar evento com campos: timestamp, level, module, message, data?', async () => {
    const logger = createLogger('scanner', { logsDir: tempDir });
    logger.info('Scanning directory', { dir: './pdfs' });
    await logger.close();

    const content = await fs.readFile(logger.logFilePath, 'utf8');
    const entry = JSON.parse(content.trim().split('\n')[0]);

    expect(entry).toMatchObject({
      level: 'info',
      module: 'scanner',
      msg: 'Scanning directory',
    });
    expect(entry.time || entry.timestamp).toBeDefined();
    expect(entry.dir).toBe('./pdfs');
  });

  test('[RED-39] deve escrever log em arquivo .log no diretório logs/ com nome da sessão', async () => {
    const logger = createLogger('scanner', { logsDir: tempDir, sessionId: 'test-session' });
    logger.info('hello');
    await logger.close();

    expect(logger.logFilePath).toBe(path.join(tempDir, 'session_test-session.log'));
    await expect(fs.access(logger.logFilePath)).resolves.toBeUndefined();
  });

  test('[RED-40] deve suportar níveis: info, warn, error, debug', async () => {
    const logger = createLogger('scanner', { logsDir: tempDir });
    logger.info('info-message');
    logger.warn('warn-message');
    logger.error('error-message');
    logger.debug('debug-message');
    await logger.close();

    const lines = (await fs.readFile(logger.logFilePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(lines.map((line) => line.level)).toEqual(
      expect.arrayContaining(['info', 'warn', 'error', 'debug']),
    );
  });

  test('[RED-41] logs de nível error devem incluir stack trace quando um Error é passado', async () => {
    const logger = createLogger('scanner', { logsDir: tempDir });
    const error = new Error('ENOENT');
    logger.error('Failed to read file', error);
    await logger.close();

    const entry = JSON.parse((await fs.readFile(logger.logFilePath, 'utf8')).trim());
    expect(entry.err).toBeDefined();
    expect(entry.err.message).toBe('ENOENT');
    expect(entry.err.stack).toContain('Error: ENOENT');
  });

  test('[RED-42] deve gravar log mesmo durante falhas de batch (não pode lançar exceção)', () => {
    const brokenAdapter = {
      write() {
        throw new Error('disk full');
      },
      close: async () => {},
    };

    const logger = createLogger('scanner', {
      logsDir: tempDir,
      loggerAdapter: brokenAdapter,
    });

    expect(() => logger.info('should not throw')).not.toThrow();
  });

  test('[RED-43] deve formatar saída como NDJSON (uma linha JSON por evento)', async () => {
    const logger = createLogger('scanner', { logsDir: tempDir });
    logger.info('first');
    logger.info('second');
    await logger.close();

    const lines = (await fs.readFile(logger.logFilePath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });
});
