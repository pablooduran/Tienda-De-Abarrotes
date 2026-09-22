(function initializeAdminNavigation() {
  'use strict';
  const main = document.querySelector('.admin-main');
  const links = Array.from(document.querySelectorAll('.admin-sidebar .nav-link'));
  const views = new Set(['tiendas', 'suscripciones-saas', 'pagos-suscripcion', 'catalogo', 'auditoria']);

  function show(view) {
    const selected = views.has(view) ? view : 'tiendas';
    main.dataset.activeView = selected;
    for (const link of links) {
      const active = link.getAttribute('href') === `#${selected}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    main.scrollTop = 0;
    window.dispatchEvent(new CustomEvent('admin:viewchange', { detail: selected }));
  }

  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const view = link.getAttribute('href').slice(1);
      if (!views.has(view)) return;
      window.history.pushState(null, '', `#${view}`);
      show(view);
    });
  }
  window.addEventListener('popstate', () => show(window.location.hash.slice(1)));
  window.addEventListener('hashchange', () => show(window.location.hash.slice(1)));
  show(window.location.hash.slice(1));
})();
