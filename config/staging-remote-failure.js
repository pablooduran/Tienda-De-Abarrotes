const contract = require('./staging-remote-status-contract.json');

const causes = new Set(contract.causes);
const phases = new Set(contract.phases);
const reasons = new Set([...contract.fallbackReasons, ...Object.keys(contract.errorCauses)]);
const phaseFailures = {
  AUTHORIZATION: ['PREREQUISITE_LOCAL', 'PRECONDITION_REJECTED'],
  CONFIGURATION: ['PREREQUISITE_LOCAL', 'PRECONDITION_REJECTED'],
  SESSION_TIME_ZONE: ['SESSION_TIME_ZONE_FAILED', 'SESSION_SETUP_FAILED'],
  READ: ['READ_FAILURE', 'READ_OPERATION_FAILED'],
  CLOSE: ['UNKNOWN_SAFE_FAILURE', 'CLOSE_FAILED'],
  EMPTY_DATABASE: ['PREREQUISITE_LOCAL', 'PRECONDITION_REJECTED'],
  MIGRATION_BASELINE: ['PREREQUISITE_LOCAL', 'PRECONDITION_REJECTED'],
  CREATE_PRIVILEGE: ['SCHEMA_CREATE_PRIVILEGE_MISSING', 'CREATE_PRIVILEGE_NOT_GRANTED'],
  BASE_SCHEMA: ['BASE_SCHEMA_DDL_FAILED', 'BASE_SCHEMA_FAILED'],
  STRUCTURE_VERIFICATION: ['STRUCTURE_VERIFICATION_FAILED', 'STRUCTURE_CHECK_FAILED'],
  MIGRATION_REGISTRY: ['MIGRATION_REGISTRY_FAILED', 'MIGRATION_REGISTRY_FAILED'],
  MIGRATION_APPLY: ['MIGRATION_APPLY_FAILED', 'MIGRATION_APPLY_FAILED']
};

function sanitizeRemoteFailure({ phase, cause, reason } = {}) {
  return {
    phase: phases.has(phase) ? phase : 'LAUNCHER',
    cause: causes.has(cause) ? cause : 'UNKNOWN_SAFE_FAILURE',
    reason: reasons.has(reason) ? reason : 'UNCLASSIFIED_ERROR'
  };
}

function classifyRemoteFailure(error, phase = 'CONNECTION') {
  let current = error;
  const found = [];
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const code = typeof current.code === 'string' ? current.code : '';
    if (Object.hasOwn(contract.errorCauses, code)) {
      found.push({ cause: contract.errorCauses[code], reason: code });
    }
    current = current.cause;
  }
  if (new Set(found.map((item) => item.cause)).size > 1) {
    return sanitizeRemoteFailure({ phase, cause: 'UNKNOWN_SAFE_FAILURE', reason: 'CONFLICTING_ERROR_CODES' });
  }
  if (found.length) {
    const detail = { ...found[found.length - 1] };
    if (phase === 'BASE_SCHEMA' && detail.cause === 'DATABASE_NOT_FOUND_OR_PERMISSION') {
      detail.cause = 'SCHEMA_CREATE_PRIVILEGE_MISSING';
    }
    if (phase === 'SESSION_TIME_ZONE') detail.cause = 'SESSION_TIME_ZONE_FAILED';
    return sanitizeRemoteFailure({ phase, ...detail });
  }
  const localReason = error instanceof TypeError ? 'LOCAL_TYPE_ERROR'
    : error instanceof RangeError ? 'LOCAL_RANGE_ERROR'
      : error instanceof ReferenceError ? 'LOCAL_REFERENCE_ERROR' : null;
  if (localReason) return sanitizeRemoteFailure({ phase, cause: 'PREREQUISITE_LOCAL', reason: localReason });
  const [cause, reason] = phaseFailures[phase] || ['UNKNOWN_SAFE_FAILURE', 'UNCLASSIFIED_ERROR'];
  return sanitizeRemoteFailure({ phase, cause, reason });
}

module.exports = { classifyRemoteFailure, sanitizeRemoteFailure };
