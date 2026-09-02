const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const launcher = path.join(root, 'scripts', 'probe-staging-mysql-tls.ps1');
const source = fs.readFileSync(launcher, 'utf8');
assert.match(source, /Read-Host 'Contrasena MySQL de staging' -AsSecureString/);
assert.match(source, /STAGING_TLS_PROBE: FAIL PREREQUISITE_LOCAL/);
assert.match(source, /Restore-EnvironmentState -Saved \$savedEnvironment/);
assert(!source.includes('Set-Content'));
assert(!source.includes('Start-Process'));
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-ValidateOnly'], { cwd: root, encoding: 'utf8' });
assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(`${result.stdout}\n${result.stderr}`, /STAGING_TLS_PROBE_VALIDATION_OK/);
console.log(JSON.stringify({ resultado: 'ok', remoteConnections: 0, secretsPersisted: false }, null, 2));
