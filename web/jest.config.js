module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  collectCoverageFrom: ['src/**/*.js', '!src/index.js'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    'src/api.js',
    'src/api-v2.js',
    'src/server.js',
    'src/adapters/index.js',
    'src/adapters/llmAdapter.js',
    'src/adapters/persistenceAdapter.js',
  ],
  coverageThreshold: {
    global: { lines: 80, functions: 80 },
  },
};
