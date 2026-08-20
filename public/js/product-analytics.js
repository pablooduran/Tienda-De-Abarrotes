(function (global) {
  const events = Object.freeze({
    welcome_started: ['module', 'step'],
    welcome_completed: ['module'],
    help_opened: ['module', 'topic'],
    plan_viewed: ['module', 'plan'],
    quote_started: ['module', 'operation', 'plan']
  });

  function safeToken(value) {
    return typeof value === 'string' && value.length <= 48 && /^[a-zA-Z0-9_-]+$/.test(value);
  }

  function track(eventName, properties) {
    const allowed = events[eventName];
    if (!allowed) return false;
    const clean = {};
    for (const key of allowed) {
      if (safeToken(properties?.[key])) clean[key] = properties[key];
    }
    try { void clean; } catch { /* Local noop only. */ }
    return true;
  }
  global.ProductAnalytics = Object.freeze({ track });
}(window));
