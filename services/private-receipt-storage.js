const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEY_PATTERN = /^receipts\/[0-9a-f]{2}\/[A-Za-z0-9_-]{43}$/;

function storageError(message, code = 'PRIVATE_STORAGE_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function defaultRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'TiendaAbarrotes', 'private', 'payment-receipts');
}

function ensurePrivateRoot(value) {
  const root = path.resolve(value || process.env.PAYMENT_RECEIPT_STORAGE_DIR || defaultRoot());
  const publicRoot = path.resolve(process.cwd(), 'public');
  const workspaceRoot = path.resolve(process.cwd());
  const relativePublic = path.relative(publicRoot, root);
  const relativeWorkspace = path.relative(workspaceRoot, root);
  if (relativePublic === '' || (!relativePublic.startsWith('..') && !path.isAbsolute(relativePublic))
    || relativeWorkspace === '' || (!relativeWorkspace.startsWith('..') && !path.isAbsolute(relativeWorkspace))) {
    throw storageError('El almacenamiento de comprobantes debe estar fuera del repositorio.', 'UNSAFE_PRIVATE_STORAGE_ROOT');
  }
  return root;
}

function createPrivateReceiptStorage({ rootDirectory } = {}) {
  const root = ensurePrivateRoot(rootDirectory);
  const temporaryRoot = path.join(root, '.tmp');

  function resolveKey(key) {
    if (!KEY_PATTERN.test(String(key || ''))) {
      throw storageError('La clave de almacenamiento no es valida.', 'INVALID_STORAGE_KEY');
    }
    const resolved = path.resolve(root, ...key.split('/'));
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw storageError('La clave de almacenamiento no es segura.', 'INVALID_STORAGE_KEY');
    }
    return resolved;
  }

  async function put(receipt) {
    await fs.promises.mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    const token = crypto.randomBytes(32).toString('base64url');
    const generatedName = `${token}.${receipt.extension}`;
    const shard = crypto.createHash('sha256').update(token).digest('hex').slice(0, 2);
    const key = `receipts/${shard}/${token}`;
    const destination = resolveKey(key);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = path.join(temporaryRoot, `${crypto.randomBytes(24).toString('hex')}.tmp`);
    let linked = false;
    try {
      await fs.promises.writeFile(temporary, receipt.buffer, { flag: 'wx', mode: 0o600 });
      await fs.promises.link(temporary, destination);
      linked = true;
      await fs.promises.rm(temporary, { force: true });
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      if (linked) await fs.promises.rm(destination, { force: true }).catch(() => {});
      throw error;
    }
    return Object.freeze({ key, generatedName });
  }

  async function open(key) {
    const location = resolveKey(key);
    const stat = await fs.promises.stat(location).catch((error) => {
      if (error.code === 'ENOENT') throw storageError('El comprobante no esta disponible.', 'RECEIPT_OBJECT_NOT_FOUND');
      throw error;
    });
    if (!stat.isFile()) throw storageError('El comprobante no esta disponible.', 'RECEIPT_OBJECT_NOT_FOUND');
    return Object.freeze({ stream: fs.createReadStream(location), size: stat.size });
  }

  async function remove(key) {
    await fs.promises.rm(resolveKey(key), { force: true });
  }

  async function removeTemporary({ olderThanMs = 60 * 60 * 1000, now = Date.now() } = {}) {
    const entries = await fs.promises.readdir(temporaryRoot, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^[0-9a-f]{48}\.tmp$/.test(entry.name)) continue;
      const location = path.join(temporaryRoot, entry.name);
      const stat = await fs.promises.stat(location);
      if (now - stat.mtimeMs >= olderThanMs) {
        await fs.promises.rm(location, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  async function health() {
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await fs.promises.stat(root);
    return Object.freeze({ available: stat.isDirectory() });
  }

  return Object.freeze({ health, open, put, remove, removeTemporary, root });
}

module.exports = { createPrivateReceiptStorage };
