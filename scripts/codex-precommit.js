const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXIT_CODES = Object.freeze({ pass: 0, warning: 1, blocked: 2 });
const EXAMPLE_ENVIRONMENTS = new Set(['.env.example', '.env.local.example']);
const FORBIDDEN_PATHS = Object.freeze([
  { code: 'ENVIRONMENT_FILE', test: (file) => /^\.env(?:\..+)?$/i.test(path.basename(file)) && !EXAMPLE_ENVIRONMENTS.has(path.basename(file)) },
  { code: 'PRIVATE_KEY_OR_CERTIFICATE', test: (file) => /\.(?:pem|key|p12|pfx)$/i.test(file) },
  { code: 'BACKUP_OR_DUMP', test: (file) => /^(?:backups|database\/backups)\//i.test(file) || (/\.(?:sql|dump)$/i.test(file) && !/^database\/(?:migrations\/|tienda_abarrotes\.sql$)/i.test(file)) },
  { code: 'BACKUP_MANIFEST', test: (file) => /\.manifest\.json$/i.test(file) },
  { code: 'LOG_OR_TEMPORARY_FILE', test: (file) => /(?:\.log$|\.tmp$|\.partial(?:\.|$)|\.bak$|\.swp$)/i.test(file) },
  { code: 'LOCAL_DATABASE', test: (file) => /\.(?:sqlite|sqlite3|db)$/i.test(file) },
  { code: 'DEPENDENCY_OR_COVERAGE_ARTIFACT', test: (file) => /^(?:node_modules|coverage|test-results|playwright-report|screenshots|artifacts)\//i.test(file) }
]);
const SECRET_PATTERNS = Object.freeze([
  ['PRIVATE_KEY', /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i],
  ['CONNECTION_URL', /(?:mysql|postgres(?:ql)?|mongodb):\/\/[^\s/:]+:[^\s@]+@/i],
  ['AUTHORIZATION_TOKEN', /(?:authorization\s*[:=]\s*['"]?(?:bearer|basic)\s+|\b(?:api[_-]?key|access[_-]?token|jwt[_-]?secret)\b\s*[:=]\s*['"])[^\s'"`]{8,}/i],
  ['CREDENTIAL_ASSIGNMENT', /\b(?:db_)?(?:password|passwd|smtp_password|session_secret)\b\s*[:=]\s*['"][^'"]{8,}['"]/i],
  ['SESSION_OR_COOKIE', /\b(?:set-cookie|cookie|session[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i]
]);

function normalizeFile(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function runGit(args, execFile = childProcess.execFileSync) {
  try {
    return { ok: true, output: String(execFile('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trimEnd() };
  } catch {
    return { ok: false, output: '' };
  }
}

function gitSnapshot(execFile = childProcess.execFileSync) {
  const result = (args) => runGit(args, execFile);
  const status = result(['status', '--porcelain=v1']);
  const files = status.output.split(/\r?\n/).filter(Boolean).map((line) => ({
    staged: line[0] !== ' ' && line[0] !== '?',
    unstaged: line[1] !== ' ',
    untracked: line.startsWith('??'),
    file: normalizeFile(line.slice(3))
  }));
  return {
    branch: result(['branch', '--show-current']).output || 'unknown',
    head: result(['rev-parse', '--short', 'HEAD']).output || 'unknown',
    files,
    unresolved: result(['diff', '--name-only', '--diff-filter=U']).output.split(/\r?\n/).filter(Boolean).map(normalizeFile),
    diffCheck: result(['diff', '--check']).ok,
    stagedDiffCheck: result(['diff', '--cached', '--check']).ok,
    migrationAtHead: (file) => result(['cat-file', '-e', `HEAD:${file}`]).ok
  };
}

function parseArguments(argv = []) {
  const allow = [];
  let collecting = false;
  for (const value of argv) {
    if (value === '--allow') { collecting = true; continue; }
    if (!collecting) throw new Error('Solo se admite el parametro --allow seguido de archivos relativos.');
    const file = normalizeFile(value);
    if (!file || path.isAbsolute(file) || file.startsWith('../') || file.includes('/../')) {
      throw new Error('La lista --allow contiene una ruta no permitida.');
    }
    allow.push(file);
  }
  return [...new Set(allow)];
}

function forbiddenFile(file) {
  const normalized = normalizeFile(file);
  return FORBIDDEN_PATHS.find((rule) => rule.test(normalized))?.code || null;
}

function secretFindings(file, content) {
  if (/\.(?:md|txt)$/i.test(file) || /(?:test|fixture|example|sample)/i.test(file)) return [];
  const findings = [];
  String(content || '').split(/\r?\n/).forEach((line, index) => {
    if (/\b(?:example|placeholder|changeme|test[-_ ]?only)\b/i.test(line)) return;
    for (const [type, pattern] of SECRET_PATTERNS) {
      if (pattern.test(line)) findings.push({ file, line: index + 1, type });
    }
  });
  return findings;
}

function migrationFindings(files, migrationAtHead, readDirectory = () => fs.readdirSync(path.join(ROOT, 'database', 'migrations'))) {
  const findings = [];
  const names = readDirectory().filter((name) => /^\d{3}_.+\.sql$/i.test(name)).sort();
  const numbers = names.map((name) => Number(name.slice(0, 3)));
  const duplicate = numbers.find((number, index) => numbers.indexOf(number) !== index);
  if (duplicate !== undefined) findings.push({ level: 'blocked', code: 'MIGRATION_NUMBER_DUPLICATE' });
  for (let number = 1; number <= (numbers[numbers.length - 1] || 0); number += 1) {
    if (!numbers.includes(number)) { findings.push({ level: 'blocked', code: 'MIGRATION_NUMBER_GAP' }); break; }
  }
  for (const file of files.filter((name) => /^database\/migrations\/\d{3}_.+\.sql$/i.test(name))) {
    if (migrationAtHead(file)) findings.push({ level: 'blocked', code: 'APPLIED_MIGRATION_MODIFIED', file });
    else {
      findings.push({ level: 'warning', code: 'NEW_MIGRATION_REVIEW_REQUIRED', file });
      findings.push({ level: 'warning', code: 'MIGRATION_DOCUMENTATION_REVIEW_REQUIRED', file });
    }
  }
  return findings;
}

function recommendations(files) {
  const joined = files.join('\n');
  const result = [];
  if (/^(?:routes|middleware|public)\//m.test(joined)) result.push('Revisar Nivel 2 de seguridad web en docs/MAPA_PRUEBAS.md.');
  if (/^(?:routes|services|database)\//m.test(joined)) result.push('Revisar aislamiento multitienda y el modulo afectado en docs/MAPA_PRUEBAS.md.');
  if (/^database\/migrations\//m.test(joined)) result.push('Seguir Nivel 1 y Nivel 2 de migraciones; no aplicar sin autorizacion.');
  return result.length ? result : ['Seleccionar Nivel 1 proporcional en docs/MAPA_PRUEBAS.md.'];
}

function classify(findings) {
  if (findings.some((finding) => finding.level === 'blocked')) return 'blocked';
  if (findings.length) return 'warning';
  return 'pass';
}

function runNodeCheck(file, spawnSync = childProcess.spawnSync) {
  const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { encoding: 'utf8', stdio: 'ignore' });
  return result.status === 0;
}

function validateJson(file, readFile) {
  try { JSON.parse(readFile(file)); return true; } catch { return false; }
}

function inspectPrecommit(options = {}) {
  const snapshot = options.snapshot || gitSnapshot(options.execFile);
  const readFile = options.readFile || ((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const allow = options.allow || [];
  const files = [...new Set(snapshot.files.map((entry) => normalizeFile(entry.file)))].filter(Boolean);
  const findings = [];
  if (files.length && !allow.length) findings.push({ level: 'warning', code: 'ALLOW_SCOPE_NOT_DECLARED' });
  for (const file of files) {
    if (allow.length && !allow.includes(file)) findings.push({ level: 'blocked', code: 'FILE_OUTSIDE_DECLARED_SCOPE', file });
    const forbidden = forbiddenFile(file);
    if (forbidden) findings.push({ level: 'blocked', code: forbidden, file });
    let content = '';
    try { content = readFile(file); } catch { findings.push({ level: 'blocked', code: 'CHANGED_FILE_UNREADABLE', file }); continue; }
    for (const secret of secretFindings(file, content)) findings.push({ level: 'blocked', code: secret.type, file: secret.file, line: secret.line });
    if (/\.json$/i.test(file) && !validateJson(file, readFile)) findings.push({ level: 'blocked', code: 'INVALID_JSON', file });
    if (/\.js$/i.test(file) && !(options.nodeCheck || runNodeCheck)(file)) findings.push({ level: 'blocked', code: 'JAVASCRIPT_SYNTAX_ERROR', file });
    if (/^(?:<<<<<<<|=======|>>>>>>>)/m.test(content)) findings.push({ level: 'blocked', code: 'CONFLICT_MARKER', file });
  }
  if (!snapshot.diffCheck) findings.push({ level: 'blocked', code: 'DIFF_CHECK_FAILED' });
  if (snapshot.files.some((entry) => entry.staged) && !snapshot.stagedDiffCheck) findings.push({ level: 'blocked', code: 'STAGED_DIFF_CHECK_FAILED' });
  for (const file of snapshot.unresolved || []) findings.push({ level: 'blocked', code: 'UNRESOLVED_CONFLICT', file });
  findings.push(...migrationFindings(files, snapshot.migrationAtHead || (() => false), options.readMigrationDirectory));
  const status = classify(findings);
  return { status, exitCode: EXIT_CODES[status], branch: snapshot.branch, head: snapshot.head, files, findings, recommendations: recommendations(files) };
}

function writeReport(result, write = console.log) {
  const count = (code) => result.findings.filter((item) => item.code === code).length;
  write(`Resultado: ${result.status.toUpperCase()}`);
  write(`Rama: ${result.branch} ${result.head}`);
  write(`Archivos revisados: ${result.files.length}`);
  write(`Sintaxis: ${count('JAVASCRIPT_SYNTAX_ERROR') ? 'error' : 'ok'}; JSON: ${count('INVALID_JSON') ? 'error' : 'ok'}`);
  write(`Secretos: ${result.findings.filter((item) => SECRET_PATTERNS.some(([code]) => code === item.code)).length ? 'risk' : 'none'}`);
  write(`Archivos prohibidos: ${result.findings.filter((item) => FORBIDDEN_PATHS.some((rule) => rule.code === item.code)).length ? 'risk' : 'none'}`);
  write(`Migraciones: ${result.findings.filter((item) => item.code.includes('MIGRATION')).map((item) => item.code).join(',') || 'ok'}`);
  write(`Pruebas recomendadas: ${result.recommendations.join(' ')}`);
  write(`Bloqueos: ${result.findings.filter((item) => item.level === 'blocked').map((item) => `${item.file || 'repo'}:${item.line || '-'}:${item.code}`).join(',') || 'none'}`);
}

function main() {
  try {
    const allow = parseArguments(process.argv.slice(2));
    const result = inspectPrecommit({ allow });
    writeReport(result);
    process.exitCode = result.exitCode;
  } catch {
    console.log('Resultado: BLOCKED');
    console.log('Bloqueos: repo:-:PRECOMMIT_CONFIGURATION_ERROR');
    process.exitCode = EXIT_CODES.blocked;
  }
}

if (require.main === module) main();

module.exports = {
  EXIT_CODES,
  FORBIDDEN_PATHS,
  SECRET_PATTERNS,
  classify,
  inspectPrecommit,
  migrationFindings,
  parseArguments,
  secretFindings,
  writeReport
};
