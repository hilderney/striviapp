'use strict';

const path = require('path');
const { resolveDesktopPaths } = require('../desktop/desktopConfig');
const { hashMachineId, NAMESPACE } = require('../desktop/machineIdentity');

describe('desktopConfig', () => {
  test('resolveDesktopPaths usa userData e Documents absolutos', () => {
    const paths = resolveDesktopPaths({
      userData: 'C:\\Users\\demo\\AppData\\Roaming\\Striviapp',
      documents: 'C:\\Users\\demo\\Documents',
    });
    expect(paths.dbPath).toBe(
      path.join(
        'C:\\Users\\demo\\AppData\\Roaming\\Striviapp',
        'app-data',
        'app.db',
      ),
    );
    expect(paths.outputDir).toBe(
      path.join('C:\\Users\\demo\\Documents', 'Striviapp'),
    );
    expect(paths.stagingDir).toContain('staging');
  });
});

describe('machineIdentity', () => {
  test('[F7-14] mesmo raw ID + namespace produz o mesmo SHA-256', () => {
    const a = hashMachineId('stable-id-1');
    const b = hashMachineId('stable-id-1');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(NAMESPACE).toBe('striviapp:v2:');
  });

  test('[F7-16] hash enviado possui exatamente 64 hex chars', () => {
    const hash = hashMachineId('abc');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
