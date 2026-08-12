const path = require('path');
const crypto = require('crypto');

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_FIELD_NAME = 'comprobante';
const RECEIPT_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const ALLOWED_RECEIPT_STATES = Object.freeze(['pendiente_comprobante', 'observada']);
const ALLOWED_EXTENSIONS = Object.freeze(['pdf', 'jpg', 'jpeg', 'png']);
const MIME_BY_EXTENSION = Object.freeze({
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png'
});

function receiptError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function receiptReference(value) {
  const normalized = String(value || '').trim();
  if (!RECEIPT_REFERENCE_PATTERN.test(normalized)) {
    throw receiptError(400, 'La referencia del comprobante no es valida.', 'INVALID_RECEIPT_REFERENCE');
  }
  return normalized;
}

function safeOriginalName(value) {
  const original = String(value || '').normalize('NFKC').trim();
  if (!original || original.length > 180 || /[\\/\u0000-\u001F\u007F]/.test(original)) {
    throw receiptError(400, 'El nombre del archivo no es valido.', 'INVALID_RECEIPT_FILENAME');
  }
  const extension = path.extname(original).slice(1).toLowerCase();
  const base = original.slice(0, -(extension.length + 1));
  if (!base || base.includes('.') || !ALLOWED_EXTENSIONS.includes(extension)) {
    throw receiptError(400, 'El archivo debe tener una unica extension permitida.', 'INVALID_RECEIPT_EXTENSION');
  }
  if (!/^[\p{L}\p{N} _()-]+$/u.test(base)) {
    throw receiptError(400, 'El nombre del archivo contiene caracteres no permitidos.', 'INVALID_RECEIPT_FILENAME');
  }
  const sanitizedBase = base.replace(/\s+/g, ' ').slice(0, 170 - extension.length).trim();
  return Object.freeze({ extension, sanitized: `${sanitizedBase}.${extension}` });
}

function isPdf(buffer) {
  if (buffer.length < 12 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') return false;
  const body = buffer.toString('latin1');
  if (!body.includes('startxref') || !body.includes('trailer')) return false;
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
  return /%%EOF[\t\r\n ]*$/.test(tail);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) return false;
  let offset = 8;
  let first = true;
  let sawEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const next = offset + 12 + length;
    if (next > buffer.length) return false;
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return false;
    if (first && (type !== 'IHDR' || length !== 13)) return false;
    if (type === 'IEND') {
      if (length !== 0 || next !== buffer.length) return false;
      sawEnd = true;
      break;
    }
    first = false;
    offset = next;
  }
  return sawEnd;
}

function isJpeg(buffer) {
  if (buffer.length < 20
    || buffer[0] !== 0xff || buffer[1] !== 0xd8
    || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) return false;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let sawFrame = false;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) return false;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) return sawFrame && offset === buffer.length;
    if (marker === 0x00 || marker === 0xd8) return false;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return false;
    if (startOfFrame.has(marker)) sawFrame = true;
    if (marker !== 0xda) {
      offset += length;
      continue;
    }
    if (!sawFrame) return false;
    offset += length;
    let nextScanMarker = false;
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const next = buffer[offset + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (next === 0xd9) return offset + 2 === buffer.length;
      nextScanMarker = true;
      break;
    }
    if (!nextScanMarker) return false;
  }
  return false;
}

function detectContent(buffer) {
  if (isPdf(buffer)) return Object.freeze({ extensionFamily: ['pdf'], mime: 'application/pdf' });
  if (isPng(buffer)) return Object.freeze({ extensionFamily: ['png'], mime: 'image/png' });
  if (isJpeg(buffer)) return Object.freeze({ extensionFamily: ['jpg', 'jpeg'], mime: 'image/jpeg' });
  throw receiptError(400, 'El archivo esta vacio, corrupto o no tiene un formato permitido.', 'INVALID_RECEIPT_CONTENT');
}

function validateReceiptFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw receiptError(400, 'Debe adjuntar un comprobante.', 'RECEIPT_REQUIRED');
  }
  if (!file.buffer.length) {
    throw receiptError(400, 'El comprobante no puede estar vacio.', 'EMPTY_RECEIPT');
  }
  if (file.buffer.length > MAX_RECEIPT_BYTES) {
    throw receiptError(413, 'El comprobante supera el limite de 5 MiB.', 'RECEIPT_TOO_LARGE');
  }
  const name = safeOriginalName(file.originalname);
  const detected = detectContent(file.buffer);
  if (!detected.extensionFamily.includes(name.extension)
    || String(file.mimetype || '').toLowerCase() !== detected.mime
    || MIME_BY_EXTENSION[name.extension] !== detected.mime) {
    throw receiptError(400, 'La extension, el tipo declarado y el contenido no coinciden.', 'RECEIPT_TYPE_MISMATCH');
  }
  return Object.freeze({
    buffer: file.buffer,
    originalName: name.sanitized,
    extension: name.extension,
    mime: detected.mime,
    size: file.buffer.length,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex')
  });
}

module.exports = {
  ALLOWED_RECEIPT_STATES,
  MAX_RECEIPT_BYTES,
  RECEIPT_FIELD_NAME,
  receiptError,
  receiptReference,
  validateReceiptFile
};
