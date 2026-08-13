const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_BYTES = 72;

function validPasswordLength(value) {
  return typeof value === 'string'
    && value.length >= PASSWORD_MIN_LENGTH
    && Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES;
}

module.exports = {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  validPasswordLength
};
