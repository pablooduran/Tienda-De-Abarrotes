const EVENTS = Object.freeze({
  account_registered: { source: 'business', properties: ['module', 'plan'] },
  email_verified: { source: 'business', properties: ['module'] },
  store_configured: { source: 'business', properties: ['module'] },
  product_created: { source: 'business', properties: ['module', 'mode'] },
  stock_registered: { source: 'business', properties: ['module', 'mode'] },
  sale_completed: { source: 'business', properties: ['module', 'paymentMode', 'currency'] },
  customer_created: { source: 'business', properties: ['module'] },
  credit_sale_completed: { source: 'business', properties: ['module', 'currency'] },
  collection_completed: { source: 'business', properties: ['module', 'currency'] },
  welcome_started: { source: 'ux', properties: ['module', 'step'] },
  welcome_completed: { source: 'ux', properties: ['module'] },
  help_opened: { source: 'ux', properties: ['module', 'topic'] },
  plan_viewed: { source: 'ux', properties: ['module', 'plan'] },
  quote_started: { source: 'ux', properties: ['module', 'operation', 'plan'] },
  payment_request_created: { source: 'business', properties: ['module', 'operation', 'plan', 'currency'] }
  ,subscription_cancel_started: { source: 'ux', properties: ['module', 'reason', 'plan', 'mode'] }
  ,subscription_cancelled: { source: 'business', properties: ['module', 'reason', 'plan', 'mode'] }
});

function sanitize(eventName, properties = {}) {
  const event = EVENTS[eventName];
  if (!event) return null;
  const clean = {};
  for (const key of event.properties) {
    const value = properties[key];
    if (typeof value === 'string' && value.length <= 48 && /^[a-zA-Z0-9_-]+$/.test(value)) clean[key] = value;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) clean[key] = value;
  }
  return { eventName, properties: clean, source: event.source };
}

module.exports = { EVENTS, sanitize };
