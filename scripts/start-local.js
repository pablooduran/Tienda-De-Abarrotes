const path = require('path');
const { spawn } = require('child_process');

function createLocalEnvironment(source = process.env) {
  return { ...source, APP_ENV: 'local' };
}

function run() {
  process.env.APP_ENV = 'local';

  const {
    databaseTarget,
    environmentFile,
    requireLocalhostDatabase
  } = require('../config/env');
  const database = requireLocalhostDatabase('El inicio local');

  console.log(
    `Inicio local verificado. APP_ENV=local configuracion=${environmentFile} ${databaseTarget(database)}.`
  );

  if (process.argv.includes('--check')) return;

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: createLocalEnvironment(),
    stdio: 'inherit'
  });

  child.once('error', (error) => {
    console.error(`No se pudo iniciar el servidor local: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (require.main === module) run();

module.exports = {
  createLocalEnvironment,
  run
};
