'use strict';

const crypto = require('crypto');

const NAMESPACE = 'striviapp:v2:';

/**
 * @param {string} rawMachineId
 * @returns {string} 64-char hex SHA-256
 */
function hashMachineId(rawMachineId) {
  if (typeof rawMachineId !== 'string' || !rawMachineId.trim()) {
    throw new Error('rawMachineId is required');
  }
  return crypto.createHash('sha256').update(NAMESPACE + rawMachineId.trim()).digest('hex');
}

/**
 * Returns only the machine hash. Raw ID never leaves this module in production callers.
 */
function getMachineHash(getRawId = () => require('node-machine-id').machineIdSync()) {
  return hashMachineId(getRawId());
}

module.exports = {
  NAMESPACE,
  hashMachineId,
  getMachineHash,
};
