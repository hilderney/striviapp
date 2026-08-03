class PersistenceAdapter {
  async init(_options) {
    throw new Error('PersistenceAdapter.init() must be implemented');
  }

  async close() {
    throw new Error('PersistenceAdapter.close() must be implemented');
  }

  async createLlmModel(_data) {
    throw new Error('PersistenceAdapter.createLlmModel() must be implemented');
  }

  async getLlmModel(_id) {
    throw new Error('PersistenceAdapter.getLlmModel() must be implemented');
  }

  async listLlmModels(_filter) {
    throw new Error('PersistenceAdapter.listLlmModel() must be implemented');
  }

  async updateLlmModel(_id, _data) {
    throw new Error('PersistenceAdapter.updateLlmModel() must be implemented');
  }

  async deleteLlmModel(_id) {
    throw new Error('PersistenceAdapter.deleteLlmModel() must be implemented');
  }

  async createLlmJob(_data) {
    throw new Error('PersistenceAdapter.createLlmJob() must be implemented');
  }

  async getLlmJob(_id) {
    throw new Error('PersistenceAdapter.getLlmJob() must be implemented');
  }

  async listLlmJobs(_filter) {
    throw new Error('PersistenceAdapter.listLlmJobs() must be implemented');
  }

  async updateLlmJob(_id, _data) {
    throw new Error('PersistenceAdapter.updateLlmJob() must be implemented');
  }

  async createUser(_data) {
    throw new Error('PersistenceAdapter.createUser() must be implemented');
  }

  async getUserById(_id) {
    throw new Error('PersistenceAdapter.getUserById() must be implemented');
  }

  async getUserByUsername(_username) {
    throw new Error('PersistenceAdapter.getUserByUsername() must be implemented');
  }

  async updateUser(_id, _data) {
    throw new Error('PersistenceAdapter.updateUser() must be implemented');
  }

  async listUsers() {
    throw new Error('PersistenceAdapter.listUsers() must be implemented');
  }

  async countUsers() {
    throw new Error('PersistenceAdapter.countUsers() must be implemented');
  }

  async insertRefreshToken(_data) {
    throw new Error('PersistenceAdapter.insertRefreshToken() must be implemented');
  }

  async getRefreshToken(_tokenHash) {
    throw new Error('PersistenceAdapter.getRefreshToken() must be implemented');
  }

  async revokeRefreshToken(_tokenHash) {
    throw new Error('PersistenceAdapter.revokeRefreshToken() must be implemented');
  }
}

function createPersistenceAdapter(type = 'sqlite', options = {}) {
  switch (type) {
    case 'sqlite':
      return new (require('./sqlitePersistenceAdapter').SqlitePersistenceAdapter)(options);
    case 'memory':
      return new (require('./memoryPersistenceAdapter').InMemoryPersistenceAdapter)(options);
    case 'mysql':
      return new (require('./mysqlPersistenceAdapter').MysqlPersistenceAdapter)(options);
    default:
      throw new Error(`Unknown persistence adapter: ${type}`);
  }
}

module.exports = {
  PersistenceAdapter,
  createPersistenceAdapter,
};
