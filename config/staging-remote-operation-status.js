const contract = require('./staging-remote-status-contract.json');
const { classifyRemoteFailure, sanitizeRemoteFailure } = require('./staging-remote-failure');

const REMOTE_OPERATION_CAUSES = Object.freeze(Object.fromEntries(contract.causes.map((cause) => [cause, cause])));

function classifyRemoteOperationFailure(error, phase) {
  return classifyRemoteFailure(error, phase).cause;
}

function remoteOperationStatus(operation, result) {
  const normalized = operation === 'MIGRATE' ? 'MIGRATE' : 'INIT';
  if (result?.passed) return `STAGING_REMOTE_DB_${normalized}: PASS`;
  const safe = sanitizeRemoteFailure(result);
  return `STAGING_REMOTE_DB_${normalized}: FAIL ${safe.phase} ${safe.cause} ${safe.reason}`;
}

module.exports = { REMOTE_OPERATION_CAUSES, classifyRemoteOperationFailure, remoteOperationStatus };
