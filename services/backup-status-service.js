const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const {
  BackupError,
  resolveBackupDirectoryPath,
  verifyBackup
} = require('../scripts/backup-utils');

const BACKUP_NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}_\d{4}-\d{2}-\d{2}_\d{6}\.sql$/;
const ERROR_CODES = Object.freeze({
  BACKUP_DIRECTORY_NOT_FOUND: 'BACKUP_MISSING',
  BACKUP_FILE_NOT_FOUND: 'BACKUP_MISSING',
  BACKUP_MANIFEST_NOT_FOUND: 'BACKUP_MANIFEST_MISSING',
  BACKUP_MANIFEST_INVALID: 'BACKUP_MANIFEST_INVALID',
  BACKUP_MANIFEST_INTEGRITY_FAILED: 'BACKUP_MANIFEST_INVALID',
  BACKUP_MANIFEST_FILE_MISMATCH: 'BACKUP_MANIFEST_INVALID',
  BACKUP_MANIFEST_NOT_VERIFIED: 'BACKUP_MANIFEST_INVALID',
  BACKUP_MANIFEST_STRUCTURE_INVALID: 'BACKUP_MANIFEST_INVALID',
  BACKUP_VERSION_INCOMPATIBLE: 'BACKUP_MANIFEST_INVALID',
  BACKUP_SIZE_MISMATCH: 'BACKUP_SIZE_MISMATCH',
  BACKUP_HASH_MISMATCH: 'BACKUP_CHECKSUM_MISMATCH',
  BACKUP_HEADER_INVALID: 'BACKUP_SQL_INCOMPLETE',
  BACKUP_INCOMPLETE: 'BACKUP_SQL_INCOMPLETE',
  BACKUP_REQUIRED_TABLES_MISSING: 'BACKUP_SQL_INCOMPLETE',
  BACKUP_DATABASE_STATEMENT_FORBIDDEN: 'BACKUP_SQL_INCOMPLETE'
});

function roundedMilliseconds(value) {
  return Number(Math.max(0, value).toFixed(1));
}

function result(status, code, durationMs, checkedAt, extras = {}) {
  return Object.freeze({
    status,
    code,
    durationMs: roundedMilliseconds(durationMs),
    checkedAt,
    ...extras
  });
}

function safeStat(fsApi, filePath) {
  try {
    const stat = fsApi.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return stat;
  } catch {
    return null;
  }
}

function snapshotKey(directory, candidate, manifestStat) {
  if (!candidate) return `${directory}\u0000missing`;
  return [
    directory,
    candidate.name,
    candidate.stat.size,
    candidate.stat.mtimeMs,
    manifestStat?.size ?? 'missing',
    manifestStat?.mtimeMs ?? 'missing'
  ].join('\u0000');
}

function inspectDirectory({ directory, fsApi, candidateLimit }) {
  const directoryStat = fsApi.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new BackupError('BACKUP_DIRECTORY_UNSAFE', 'El directorio de backups no es seguro.');
  }
  const entries = fsApi.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && !entry.isSymbolicLink()
      && entry.name === path.basename(entry.name)
      && BACKUP_NAME_PATTERN.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name))
    .slice(0, candidateLimit);
  const candidates = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const stat = safeStat(fsApi, filePath);
    if (stat) candidates.push({ name: entry.name, path: filePath, stat });
  }
  candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs
    || right.name.localeCompare(left.name));
  const candidate = candidates[0] || null;
  const manifestPath = candidate
    ? candidate.path.replace(/\.sql$/i, '.manifest.json')
    : null;
  const manifestStat = manifestPath ? safeStat(fsApi, manifestPath) : null;
  return {
    candidate,
    manifestStat,
    inspectedCandidates: candidates.length,
    key: snapshotKey(directory, candidate, manifestStat)
  };
}

function mappedCode(error) {
  if (error?.code === 'ENOENT') return 'BACKUP_MISSING';
  return ERROR_CODES[error?.code] || 'BACKUP_CHECK_FAILED';
}

function createBackupStatusService(options = {}) {
  const {
    environment = process.env,
    fsApi = fs,
    directoryResolver = () => resolveBackupDirectoryPath(environment),
    verifier = (filePath) => verifyBackup(filePath, { environment, readOnly: true }),
    warningHours = 24,
    criticalHours = 48,
    cacheMs = 300000,
    candidateLimit = 100,
    clock = () => new Date(),
    monotonicNow = () => performance.now()
  } = options;
  if (!(Number.isFinite(warningHours) && warningHours > 0
    && Number.isFinite(criticalHours) && criticalHours > warningHours)) {
    throw new Error('Los umbrales de antiguedad del backup no son validos.');
  }
  if (!(Number.isFinite(cacheMs) && cacheMs >= 0)) {
    throw new Error('El TTL del estado de backup no es valido.');
  }
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 1000) {
    throw new Error('El limite de candidatos de backup no es valido.');
  }

  let cached = null;
  const inFlight = new Map();

  async function perform(snapshot, startedAt) {
    const checkedAt = clock().toISOString();
    if (!snapshot.candidate) {
      return result('error', 'BACKUP_MISSING', monotonicNow() - startedAt, checkedAt, {
        inspectedCandidates: snapshot.inspectedCandidates
      });
    }
    try {
      const verification = await verifier(snapshot.candidate.path);
      const createdAt = Date.parse(verification?.manifest?.backup?.createdUtc);
      const now = clock().getTime();
      if (!Number.isFinite(createdAt) || createdAt > now + 5 * 60 * 1000) {
        return result('error', 'BACKUP_MANIFEST_INVALID', monotonicNow() - startedAt, checkedAt, {
          inspectedCandidates: snapshot.inspectedCandidates
        });
      }
      const ageHours = Math.max(0, now - createdAt) / 3600000;
      const publicAge = Number(ageHours.toFixed(1));
      if (ageHours > criticalHours) {
        return result('error', 'BACKUP_TOO_OLD', monotonicNow() - startedAt, checkedAt, {
          ageHours: publicAge,
          inspectedCandidates: snapshot.inspectedCandidates
        });
      }
      if (ageHours >= warningHours) {
        return result('warning', 'BACKUP_STALE', monotonicNow() - startedAt, checkedAt, {
          ageHours: publicAge,
          inspectedCandidates: snapshot.inspectedCandidates
        });
      }
      return result('ok', 'BACKUP_OK', monotonicNow() - startedAt, checkedAt, {
        ageHours: publicAge,
        inspectedCandidates: snapshot.inspectedCandidates
      });
    } catch (error) {
      return result('error', mappedCode(error), monotonicNow() - startedAt, checkedAt, {
        inspectedCandidates: snapshot.inspectedCandidates
      });
    }
  }

  async function status() {
    const startedAt = monotonicNow();
    let directory;
    let snapshot;
    try {
      directory = directoryResolver();
      snapshot = inspectDirectory({ directory, fsApi, candidateLimit });
    } catch (error) {
      return result('error', mappedCode(error), monotonicNow() - startedAt, clock().toISOString());
    }
    const now = monotonicNow();
    if (cached && cached.key === snapshot.key && now < cached.expiresAt) {
      return cached.value;
    }
    if (inFlight.has(snapshot.key)) return inFlight.get(snapshot.key);
    const work = perform(snapshot, startedAt)
      .then((value) => {
        if (cacheMs > 0) {
          cached = { key: snapshot.key, value, expiresAt: monotonicNow() + cacheMs };
        }
        return value;
      })
      .finally(() => {
        inFlight.delete(snapshot.key);
      });
    inFlight.set(snapshot.key, work);
    return work;
  }

  function clearCache() {
    cached = null;
  }

  return Object.freeze({
    clearCache,
    status
  });
}

module.exports = {
  BACKUP_NAME_PATTERN,
  ERROR_CODES,
  createBackupStatusService,
  inspectDirectory,
  mappedCode
};
