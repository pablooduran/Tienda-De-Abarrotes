(function initializeStoreTheme(global) {
  'use strict';

  const key = 'tienda-apariencia';
  function get() {
    try { return global.localStorage.getItem(key) === 'dark' ? 'dark' : 'light'; }
    catch (_) { return 'light'; }
  }
  function apply(theme) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    global.document.documentElement.dataset.theme = selected;
    return selected;
  }
  function set(theme) {
    const selected = apply(theme);
    try { global.localStorage.setItem(key, selected); } catch (_) { /* The visual choice still works for this page. */ }
    updateToggles();
    return selected;
  }

  function updateToggles() {
    global.document.querySelectorAll('[data-toggle-theme]').forEach((button) => {
      const dark = global.document.documentElement.dataset.theme === 'dark';
      button.textContent = dark ? 'Modo claro' : 'Modo oscuro';
      button.setAttribute('aria-pressed', String(dark));
    });
  }

  apply(get());
  global.document.addEventListener('DOMContentLoaded', () => {
    global.document.querySelectorAll('[data-toggle-theme]').forEach((button) => {
      button.addEventListener('click', () => set(global.document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    });
    updateToggles();
  });
  global.StoreTheme = Object.freeze({ get, set });
}(window));
