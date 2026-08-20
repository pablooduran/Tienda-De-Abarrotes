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

function createBusinessAnalytics(analytics = createAnalytics()) {
  function confirmed(eventName, properties, confirmation) {
    if (!confirmation) return false;
    try {
      return analytics.track(eventName, properties);
    } catch {
      return false;
    }
  }

  return Object.freeze({
    accountRegistered({ created, replayed = false, plan } = {}) {
      return confirmed('account_registered', { module: 'registration', plan }, created && !replayed);
    },
    emailVerified({ changed } = {}) {
      return confirmed('email_verified', { module: 'authentication' }, changed);
    },
    storeConfigured({ completed, repeated = false } = {}) {
      return confirmed('store_configured', { module: 'onboarding' }, completed && !repeated);
    },
    stockRegistered({ registered, repeated = false, mode = 'manual_adjustment' } = {}) {
      return confirmed('stock_registered', { module: 'inventory', mode }, registered && !repeated);
    },
    saleCompleted({ completed, repeated = false, paymentMode, currency = 'BOB' } = {}) {
      return confirmed(
        'sale_completed',
        { module: 'pos', paymentMode, currency },
        completed && !repeated
      );
    }
  });
}

const businessAnalytics = createBusinessAnalytics();

module.exports = {
  businessAnalytics,
  createAnalytics,
  createBusinessAnalytics,
  createNoopAdapter,
  createMemoryAdapter
};
