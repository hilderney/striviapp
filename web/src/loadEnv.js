const path = require('path');

function loadEnv(options = {}) {
  const root = options.root ?? path.join(__dirname, '..');
  const envPath = options.envPath ?? path.join(root, '.env');

  require('dotenv').config({ path: envPath, quiet: true });
}

module.exports = {
  loadEnv,
};
