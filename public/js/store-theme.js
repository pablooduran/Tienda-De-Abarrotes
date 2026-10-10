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
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      const label = button.querySelector('[data-theme-label]')
        || button.closest('.auth-setting-row')?.querySelector('[data-theme-label]');
      if (label) label.textContent = dark ? 'Oscuro' : 'Claro';
      else if (!button.classList.contains('auth-theme-switch')) button.textContent = dark ? 'Modo claro' : 'Modo oscuro';
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
