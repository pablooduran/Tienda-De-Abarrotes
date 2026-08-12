const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MAX_RECEIPT_BYTES,
  receiptReference,
  validateReceiptFile
} = require('../config/saas-c-payment-receipt-contract');
const { createPrivateReceiptStorage } = require('../services/private-receipt-storage');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8rZ55LmaSaaRpZZGLvI7EszE5JJPUmiiis6fwL0OvF/7xU/xP8z//2Q==',
  'base64'
);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Root 1 0 R /Size 2 >>\nstartxref\n45\n%%EOF\n',
  'ascii'
);

function file(name, mime, buffer) {
  return { originalname: name, mimetype: mime, buffer };
}

function rejects(callback, code) {
  assert.throws(callback, (error) => error.code === code, `Se esperaba ${code}.`);
}

async function main() {
  const pdf = validateReceiptFile(file('comprobante.pdf', 'application/pdf', PDF));
  const jpeg = validateReceiptFile(file('comprobante.jpeg', 'image/jpeg', JPEG));
  const png = validateReceiptFile(file('comprobante.png', 'image/png', PNG));
  assert.deepStrictEqual([pdf.mime, jpeg.mime, png.mime], ['application/pdf', 'image/jpeg', 'image/png']);
  rejects(() => validateReceiptFile(file('vacio.pdf', 'application/pdf', Buffer.alloc(0))), 'EMPTY_RECEIPT');
  rejects(() => validateReceiptFile(file('grande.pdf', 'application/pdf', Buffer.alloc(MAX_RECEIPT_BYTES + 1))), 'RECEIPT_TOO_LARGE');
  rejects(() => validateReceiptFile(file('falso.pdf', 'application/pdf', PNG)), 'RECEIPT_TYPE_MISMATCH');
  rejects(() => validateReceiptFile(file('falso.png', 'application/pdf', PNG)), 'RECEIPT_TYPE_MISMATCH');
  rejects(() => validateReceiptFile(file('doble.exe.pdf', 'application/pdf', PDF)), 'INVALID_RECEIPT_EXTENSION');
  rejects(() => validateReceiptFile(file('../escape.pdf', 'application/pdf', PDF)), 'INVALID_RECEIPT_FILENAME');
  rejects(() => validateReceiptFile(file('..\\escape.pdf', 'application/pdf', PDF)), 'INVALID_RECEIPT_FILENAME');
  rejects(() => validateReceiptFile(file('corrupto.png', 'image/png', PNG.subarray(0, PNG.length - 4))), 'INVALID_RECEIPT_CONTENT');
  rejects(() => receiptReference('123'), 'INVALID_RECEIPT_REFERENCE');

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tienda-saas-c3-storage-'));
  try {
    const storage = createPrivateReceiptStorage({ rootDirectory: root });
    assert.strictEqual((await storage.health()).available, true);
    const stored = await storage.put(pdf);
    assert(!stored.key.includes('comprobante'));
    assert(!stored.generatedName.includes('comprobante'));
    const opened = await storage.open(stored.key);
    const chunks = [];
    for await (const chunk of opened.stream) chunks.push(chunk);
    assert(Buffer.concat(chunks).equals(PDF));
    await assert.rejects(() => storage.open('../escape.pdf'), (error) => error.code === 'INVALID_STORAGE_KEY');
    await storage.remove(stored.key);
    await assert.rejects(() => storage.open(stored.key), (error) => error.code === 'RECEIPT_OBJECT_NOT_FOUND');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  assert.throws(
    () => createPrivateReceiptStorage({ rootDirectory: path.join(process.cwd(), 'private-receipts') }),
    (error) => error.code === 'UNSAFE_PRIVATE_STORAGE_ROOT'
  );
  console.log('test:saas-c-payment-receipt-security OK');
}

main().catch((error) => {
  console.error(`test:saas-c-payment-receipt-security FAIL: ${error.message}`);
  process.exitCode = 1;
});
