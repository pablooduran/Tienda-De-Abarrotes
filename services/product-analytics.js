const { sanitize } = require('../config/product-analytics');

function createNoopAdapter() { return Object.freeze({ track: () => undefined }); }
function createMemoryAdapter() {
  const events = [];
  return Object.freeze({ events, track: (event) => events.push(event) });
}
function createAnalytics(adapter = createNoopAdapter()) {
  return Object.freeze({
    track(eventName, properties) {
      const event = sanitize(eventName, properties);
      if (!event) return false;
      try { adapter.track(event); } catch { /* Analytics never interrupts business. */ }
      return true;
    }
  });
}

module.exports = { createAnalytics, createNoopAdapter, createMemoryAdapter };
