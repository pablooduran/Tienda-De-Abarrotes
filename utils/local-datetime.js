const { BUSINESS_TIME_ZONE, MYSQL_SESSION_TIME_ZONE } = require('../config/database-options');

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const BUSINESS_OFFSET_MINUTES = -240;
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function validDate(value, label = 'La fecha') {
  const date = value === undefined ? new Date() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} no es valida.`);
  }
  return date;
}

function dateTimeParts(value) {
  const date = validDate(value);
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDate(date = new Date()) {
  const parts = dateTimeParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function formatLocalDateTime(date = new Date()) {
  const parts = dateTimeParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} `
    + `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function validCivilParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1
    || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const civil = new Date(Date.UTC(year, month - 1, day));
  return civil.getUTCFullYear() === year && civil.getUTCMonth() === month - 1 && civil.getUTCDate() === day;
}

function instantFromCivil(year, month, day, hour = 0, minute = 0, second = 0) {
  if (!validCivilParts(year, month, day, hour, minute, second)) {
    throw new TypeError('La fecha local no es valida.');
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute - BUSINESS_OFFSET_MINUTES, second));
}

function createLocalDate(year, month, day) {
  return instantFromCivil(Number(year), Number(month), Number(day));
}

function parseLocalDate(value) {
  const match = String(value || '').trim().match(DATE_PATTERN);
  if (!match) throw new TypeError('La fecha debe usar el formato AAAA-MM-DD.');
  return instantFromCivil(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseLocalDateTime(value) {
  const text = String(value || '').trim();
  const dateMatch = text.match(DATE_PATTERN);
  if (dateMatch) return parseLocalDate(text);
  const match = text.match(DATETIME_PATTERN);
  if (!match) throw new TypeError('La fecha y hora debe usar el formato AAAA-MM-DD HH:mm:ss.');
  return instantFromCivil(
    Number(match[1]), Number(match[2]), Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0)
  );
}

function getLocalNow() {
  return new Date();
}

function startOfLocalDay(value = getLocalNow()) {
  return parseLocalDate(formatLocalDate(validDate(value)));
}

function addLocalDays(value, days) {
  if (!Number.isInteger(days)) throw new TypeError('La cantidad de dias debe ser un entero.');
  const date = value instanceof Date ? validDate(value) : parseLocalDateTime(value);
  const parts = dateTimeParts(date);
  const shifted = new Date(Date.UTC(
    parts.year, parts.month - 1, parts.day + days,
    parts.hour, parts.minute - BUSINESS_OFFSET_MINUTES, parts.second
  ));
  return shifted;
}

function compareLocalDates(left, right) {
  const leftText = left instanceof Date ? formatLocalDate(left) : formatLocalDate(parseLocalDate(left));
  const rightText = right instanceof Date ? formatLocalDate(right) : formatLocalDate(parseLocalDate(right));
  return leftText.localeCompare(rightText);
}

function buildSemiOpenDateRange(from, through) {
  const start = parseLocalDate(from);
  const endExclusive = addLocalDays(parseLocalDate(through), 1);
  if (endExclusive <= start) throw new RangeError('El rango local no es valido.');
  return {
    inicio: formatLocalDateTime(start),
    finExclusivo: formatLocalDateTime(endExclusive),
    desde: formatLocalDate(start),
    hasta: formatLocalDate(addLocalDays(endExclusive, -1))
  };
}

module.exports = {
  BUSINESS_TIME_ZONE,
  MYSQL_SESSION_TIME_ZONE,
  addLocalDays,
  buildSemiOpenDateRange,
  compareLocalDates,
  createLocalDate,
  dateTimeParts,
  formatLocalDate,
  formatLocalDateTime,
  getLocalNow,
  parseLocalDate,
  parseLocalDateTime,
  startOfLocalDay
};
