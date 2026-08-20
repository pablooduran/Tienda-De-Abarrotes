(function (global) {
  const events = new Set(['welcome_started', 'welcome_completed', 'help_opened', 'plan_viewed', 'quote_started']);
  function track(eventName, properties) {
    if (!events.has(eventName)) return false;
    try { void properties; } catch { /* Local noop only. */ }
    return true;
  }
  global.ProductAnalytics = Object.freeze({ track });
}(window));
