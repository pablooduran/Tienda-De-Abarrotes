(function exposeWorkspaceExperience(global) {
  const STORAGE_PREFIX = 'administrau-workspace-v1';

  function create(options) {
    const { sections, navigate, getState, api, escapeHtml } = options;
    const root = document.getElementById('workspaceExperienceRoot');
    const tools = document.getElementById('workspaceTools');
    const state = { activeView: 'inicio', searchOpen: false, notificationsOpen: false };
    let searchInput = null;
    let saveTimer = null;

    function scope() {
      const store = document.getElementById('storeName')?.textContent?.trim() || 'tienda';
      return store.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, '-').slice(0, 48);
    }

    function storageKey(type, name) {
      return `${STORAGE_PREFIX}:${scope()}:${type}:${name}`;
    }

    function read(type, name, fallback = null) {
      try {
        const value = global.localStorage.getItem(storageKey(type, name));
        return value ? JSON.parse(value) : fallback;
      } catch (_) { return fallback; }
    }

    function write(type, name, value) {
      try { global.localStorage.setItem(storageKey(type, name), JSON.stringify(value)); } catch (_) { /* La app sigue operativa sin almacenamiento. */ }
    }

    function remove(type, name) {
      try { global.localStorage.removeItem(storageKey(type, name)); } catch (_) { /* No bloquear la operación. */ }
    }

    function drafts() {
      return ['ventas', 'compras'].filter((name) => read('draft', name));
    }

    function notificationItems() {
      const app = getState();
      const lowStock = (app.productos || []).filter((product) => Number(product.stockUnidadesTotal || 0) <= Number(product.stockMinimo || 0));
      const debts = (app.fiados || []).filter((debt) => Number(debt.saldoPendiente || debt.saldo || 0) > 0);
      const savedDrafts = drafts();
      const items = [];
      if (lowStock.length) items.push({ tone: 'warning', title: `${lowStock.length} producto${lowStock.length === 1 ? '' : 's'} con stock bajo`, detail: 'Revisa inventario antes de la próxima venta.', view: 'productos' });
      if (debts.length) items.push({ tone: 'info', title: `${debts.length} fiado${debts.length === 1 ? '' : 's'} activo${debts.length === 1 ? '' : 's'}`, detail: 'Tienes saldos que puedes revisar en Cobranza.', view: 'pagos' });
      savedDrafts.forEach((name) => items.push({ tone: 'success', title: name === 'ventas' ? 'Venta guardada como borrador' : 'Compra guardada como borrador', detail: 'Puedes retomarla sin volver a cargar los productos.', view: name }));
      return items;
    }

    function renderTools() {
      const count = notificationItems().length;
      tools.innerHTML = `
        <button type="button" class="workspace-tool-button" data-workspace-search aria-label="Buscar en la aplicación"><span aria-hidden="true">⌕</span><span class="workspace-tool-label">Buscar</span></button>
        <button type="button" class="workspace-tool-button workspace-notification-button" data-workspace-notifications aria-label="Abrir novedades"><span aria-hidden="true">◉</span><span class="workspace-tool-label">Novedades</span>${count ? `<span class="workspace-tool-count">${count}</span>` : ''}</button>`;
      tools.querySelector('[data-workspace-search]').addEventListener('click', openSearch);
      tools.querySelector('[data-workspace-notifications]').addEventListener('click', openNotifications);
    }

    function searchItems(query) {
      const normalized = String(query || '').trim().toLocaleLowerCase();
      const app = getState();
      const routes = sections.map(([id, label, description]) => ({ type: 'Sección', id, label, description, view: id }));
      const products = (app.productos || []).slice(0, 100).map((product) => ({ type: 'Producto', id: product.idProducto, label: product.nombre, description: `${product.categoria || 'Sin categoría'} · Stock ${Number(product.stockUnidadesTotal || 0)}`, view: 'productos' }));
      const clients = (app.clientes || []).slice(0, 100).map((client) => ({ type: 'Cliente', id: client.idCliente, label: client.nombre, description: client.telefono || 'Cliente registrado', view: 'clientes' }));
      return [...routes, ...products, ...clients]
        .filter((item) => !normalized || `${item.label} ${item.description} ${item.type}`.toLocaleLowerCase().includes(normalized))
        .slice(0, 12);
    }

    function renderSearchResults(query = '') {
      const container = root.querySelector('[data-workspace-search-results]');
      if (!container) return;
      const items = searchItems(query);
      container.innerHTML = items.length ? items.map((item, index) => `<button type="button" class="workspace-search-result" data-search-view="${escapeHtml(item.view)}" ${index === 0 ? 'data-first-result' : ''}>
        <span class="workspace-result-type">${escapeHtml(item.type)}</span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description || '')}</small>
      </button>`).join('') : '<div class="workspace-empty"><strong>Sin coincidencias</strong><p>Prueba con el nombre de una sección, producto o cliente.</p></div>';
      const buttons = [...container.querySelectorAll('[data-search-view]')];
      buttons.forEach((button, index) => {
        button.addEventListener('click', () => {
          closePanels();
          navigate(button.dataset.searchView);
        });
        button.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); (buttons[index + 1] || buttons[0])?.focus(); }
          if (event.key === 'ArrowUp') { event.preventDefault(); (buttons[index - 1] || searchInput)?.focus(); }
        });
      });
    }

    function openSearch() {
      state.searchOpen = true;
      state.notificationsOpen = false;
      root.innerHTML = `<div class="workspace-overlay" data-workspace-close></div><section class="workspace-command" role="dialog" aria-modal="true" aria-labelledby="workspaceSearchTitle">
        <header><div><span class="eyebrow">Ir rápido</span><h3 id="workspaceSearchTitle">Buscar en Administrau</h3></div><button type="button" class="icon-button" data-workspace-close aria-label="Cerrar">×</button></header>
        <label class="workspace-search-field"><span class="sr-only">Buscar</span><input type="search" placeholder="Sección, producto o cliente…" autocomplete="off"></label>
        <div class="workspace-search-results" data-workspace-search-results></div>
        <footer><span>↑ ↓ para recorrer</span><span>Enter para abrir</span><span>Esc para cerrar</span></footer>
      </section>`;
      root.querySelectorAll('[data-workspace-close]').forEach((item) => item.addEventListener('click', closePanels));
      searchInput = root.querySelector('input');
      searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') root.querySelector('[data-first-result]')?.click();
        if (event.key === 'ArrowDown') { event.preventDefault(); root.querySelector('[data-first-result]')?.focus(); }
      });
      renderSearchResults();
      searchInput.focus();
    }

    async function activityMarkup() {
      try {
        const data = await api('/api/auditoria?page=1&pageSize=5');
        const rows = data.resultados || [];
        if (!rows.length) return '<div class="workspace-empty"><strong>Sin actividad reciente</strong><p>Las acciones importantes aparecerán aquí.</p></div>';
        return rows.map((row) => `<div class="workspace-activity-item"><span class="workspace-activity-dot"></span><div><strong>${escapeHtml(String(row.accion || '').replaceAll('_', ' '))}</strong><small>${escapeHtml(row.categoria || 'Actividad')} · ${escapeHtml(row.resultado || '')}</small></div></div>`).join('');
      } catch (_) {
        return '<div class="workspace-empty"><strong>Actividad no disponible</strong><p>Puedes abrir Auditoría para consultar el historial completo.</p></div>';
      }
    }

    async function openNotifications() {
      state.notificationsOpen = true;
      state.searchOpen = false;
      const items = notificationItems();
      root.innerHTML = `<div class="workspace-overlay workspace-overlay-clear" data-workspace-close></div><aside class="workspace-drawer" role="dialog" aria-modal="true" aria-labelledby="workspaceNotificationsTitle">
        <header><div><span class="eyebrow">Tu tienda hoy</span><h3 id="workspaceNotificationsTitle">Novedades y actividad</h3></div><button type="button" class="icon-button" data-workspace-close aria-label="Cerrar">×</button></header>
        <section class="workspace-drawer-section"><h4>Requiere atención</h4><div data-notification-items>${items.length ? items.map((item) => `<button type="button" class="workspace-notification ${item.tone}" data-notification-view="${item.view}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></button>`).join('') : '<div class="workspace-empty"><strong>Todo al día</strong><p>No hay avisos pendientes en este momento.</p></div>'}</div></section>
        <section class="workspace-drawer-section"><div class="workspace-section-heading"><h4>Actividad reciente</h4><button type="button" class="link-button" data-open-audit>Ver todo</button></div><div class="workspace-activity" data-workspace-activity><p class="muted">Cargando actividad…</p></div></section>
      </aside>`;
      root.querySelectorAll('[data-workspace-close]').forEach((item) => item.addEventListener('click', closePanels));
      root.querySelectorAll('[data-notification-view]').forEach((button) => button.addEventListener('click', () => { closePanels(); navigate(button.dataset.notificationView); }));
      root.querySelector('[data-open-audit]').addEventListener('click', () => { closePanels(); navigate('auditoria'); });
      root.querySelector('[data-workspace-activity]').innerHTML = await activityMarkup();
      root.querySelector('.workspace-drawer button')?.focus();
    }

    function closePanels() {
      state.searchOpen = false;
      state.notificationsOpen = false;
      root.innerHTML = '';
      searchInput = null;
    }

    function enhanceStickyAction() {
      document.querySelectorAll('#view form').forEach((form) => {
        const submit = form.querySelector('button[type="submit"]');
        if (!submit || submit.closest('.workspace-sticky-action')) return;
        const action = document.createElement('div');
        action.className = 'workspace-sticky-action';
        submit.parentElement?.insertBefore(action, submit);
        action.appendChild(submit);
      });
    }

    function dashboardPreferences() {
      return read('preferences', 'dashboard', { hidden: [] });
    }

    function applyDashboardPreferences() {
      const widgets = [...document.querySelectorAll('[data-dashboard-widget]')];
      if (!widgets.length) return;
      const preferences = dashboardPreferences();
      widgets.forEach((widget) => { widget.hidden = preferences.hidden.includes(widget.dataset.dashboardWidget); });
    }

    function openDashboardCustomizer() {
      const widgets = [...document.querySelectorAll('[data-dashboard-widget]')];
      const preferences = dashboardPreferences();
      root.innerHTML = `<div class="workspace-overlay" data-workspace-close></div><section class="workspace-command workspace-customizer" role="dialog" aria-modal="true" aria-labelledby="customizerTitle">
        <header><div><span class="eyebrow">Tu espacio</span><h3 id="customizerTitle">Personalizar inicio</h3></div><button type="button" class="icon-button" data-workspace-close aria-label="Cerrar">×</button></header>
        <p>Elige qué bloques quieres ver. Puedes recuperarlos cuando quieras.</p>
        <div class="workspace-widget-list">${widgets.map((widget) => `<label><input type="checkbox" value="${escapeHtml(widget.dataset.dashboardWidget)}" ${preferences.hidden.includes(widget.dataset.dashboardWidget) ? '' : 'checked'}><span>${escapeHtml(widget.dataset.dashboardLabel || widget.querySelector('h3,h4')?.textContent || 'Bloque')}</span></label>`).join('')}</div>
        <div class="modal-actions"><button type="button" class="secondary" data-workspace-close>Cancelar</button><button type="button" data-save-dashboard>Guardar cambios</button></div>
      </section>`;
      root.querySelectorAll('[data-workspace-close]').forEach((item) => item.addEventListener('click', closePanels));
      root.querySelector('[data-save-dashboard]').addEventListener('click', () => {
        const hidden = [...root.querySelectorAll('.workspace-widget-list input:not(:checked)')].map((input) => input.value);
        write('preferences', 'dashboard', { hidden });
        closePanels();
        applyDashboardPreferences();
      });
    }

    function afterView(viewId) {
      state.activeView = viewId;
      enhanceStickyAction();
      if (viewId === 'inicio') applyDashboardPreferences();
      renderTools();
    }

    function saveDraft(name, payload) {
      clearTimeout(saveTimer);
      saveTimer = global.setTimeout(() => {
        if (Array.isArray(payload?.items) && payload.items.length === 0) {
          remove('draft', name);
          renderTools();
          return;
        }
        write('draft', name, { savedAt: Date.now(), payload });
        renderTools();
      }, 180);
    }

    function loadDraft(name) { return read('draft', name)?.payload || null; }
    function clearDraft(name) { remove('draft', name); renderTools(); }

    function init() {
      renderTools();
      document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
          event.preventDefault();
          openSearch();
        } else if (event.key === 'Escape' && (state.searchOpen || state.notificationsOpen)) closePanels();
        else if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
          event.preventDefault();
          openSearch();
        } else if (event.key === 'F2') {
          event.preventDefault();
          navigate('ventas');
        }
      });
    }

    return { init, afterView, saveDraft, loadDraft, clearDraft, refresh: renderTools, openDashboardCustomizer };
  }

  global.WorkspaceExperience = { create };
})(window);
