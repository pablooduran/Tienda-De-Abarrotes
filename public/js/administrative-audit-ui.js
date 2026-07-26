(function exposeAdministrativeAudit(global) {
  const CATEGORY_LABELS = Object.freeze({
    autenticacion: 'Autenticacion',
    sesion: 'Sesiones',
    credencial: 'Credenciales',
    tienda: 'Tiendas',
    propietario: 'Propietarios',
    plan: 'Planes',
    suscripcion: 'Suscripciones',
    cliente: 'Clientes',
    credito: 'Credito',
    producto: 'Productos',
    inventario: 'Inventario',
    venta: 'Ventas',
    cobranza: 'Cobranza',
    finanzas: 'Finanzas',
    compensacion: 'Compensaciones',
    exportacion: 'Exportaciones'
  });
  const RESULT_LABELS = Object.freeze({
    correcto: 'Correcto',
    rechazado: 'Rechazado',
    fallido: 'Fallido',
    limitado: 'Limitado'
  });

  function create(options) {
    const {
      api,
      root,
      mode = 'tenant',
      escapeHtml,
      formatDate
    } = options;
    const e = escapeHtml;
    const endpoint = mode === 'admin' ? '/api/admin/auditoria' : '/api/auditoria';
    const state = { page: 1, request: 0, dialog: null, trigger: null };

    function option(value, label) {
      return `<option value="${e(value)}">${e(label)}</option>`;
    }

    function filtersMarkup() {
      return `<form class="audit-filters" data-audit-filters>
        <label>Desde<input name="fechaDesde" type="date"></label>
        <label>Hasta<input name="fechaHasta" type="date"></label>
        <label>Categoria<select name="categoria"><option value="">Todas</option>${
          Object.entries(CATEGORY_LABELS).map(([value, label]) => option(value, label)).join('')
        }</select></label>
        <label>Resultado<select name="resultado"><option value="">Todos</option>${
          Object.entries(RESULT_LABELS).map(([value, label]) => option(value, label)).join('')
        }</select></label>
        <label>Actor<select name="actor"><option value="">Todos</option>
          ${option('administrador', 'Administrador')}
          ${option('sistema', 'Sistema')}
          ${option('anonimo', 'Anonimo')}
        </select></label>
        <label>Administrador<input name="idAdministrador" type="number" min="1" step="1" inputmode="numeric"></label>
        <label>Accion<input name="accion" maxlength="64" placeholder="Ej. registro_venta"></label>
        <label>Entidad<input name="entidad" maxlength="40" placeholder="Ej. venta"></label>
        ${mode === 'admin'
          ? '<label>Tienda<input name="idTienda" type="number" min="1" step="1" inputmode="numeric"></label>'
          : ''}
        <div class="audit-filter-actions">
          <button type="submit">Aplicar filtros</button>
          <button type="reset" class="secondary">Limpiar</button>
        </div>
      </form>`;
    }

    function actorLabel(actor) {
      if (actor?.tipo === 'administrador' && actor.idAdministrador) {
        return `Administrador #${Number(actor.idAdministrador)}`;
      }
      return actor?.tipo === 'sistema' ? 'Sistema' : 'Anonimo';
    }

    function eventLabel(value) {
      return String(value || '').replace(/_/g, ' ');
    }

    function resultBadge(result) {
      return `<span class="audit-status audit-status-${e(result)}">${e(RESULT_LABELS[result] || result)}</span>`;
    }

    function tableMarkup(rows, includeStore) {
      if (!rows.length) {
        return '<div class="audit-empty" role="status"><strong>Sin eventos</strong><p>No hay eventos que coincidan con los filtros.</p></div>';
      }
      const headers = `${includeStore ? '<th>Tienda</th>' : ''}<th>Fecha</th><th>Categoria</th><th>Accion</th><th>Resultado</th><th>Actor</th><th>Entidad</th><th><span class="sr-only">Detalle</span></th>`;
      const body = rows.map((row) => `<tr>
        ${includeStore ? `<td>${row.idTienda === null ? 'Global' : `#${Number(row.idTienda)}`}</td>` : ''}
        <td>${e(formatDate(row.creadoEn))}</td>
        <td>${e(CATEGORY_LABELS[row.categoria] || eventLabel(row.categoria))}</td>
        <td>${e(eventLabel(row.accion))}</td>
        <td>${resultBadge(row.resultado)}</td>
        <td>${e(actorLabel(row.actor))}</td>
        <td>${e(eventLabel(row.entidad))}</td>
        <td><button type="button" class="secondary small" data-audit-detail="${Number(row.idEventoAuditoria)}">Ver detalle</button></td>
      </tr>`).join('');
      const cards = rows.map((row) => `<article class="audit-card">
        <header><strong>${e(eventLabel(row.accion))}</strong>${resultBadge(row.resultado)}</header>
        <dl>
          <div><dt>Fecha</dt><dd>${e(formatDate(row.creadoEn))}</dd></div>
          <div><dt>Categoria</dt><dd>${e(CATEGORY_LABELS[row.categoria] || row.categoria)}</dd></div>
          <div><dt>Actor</dt><dd>${e(actorLabel(row.actor))}</dd></div>
          <div><dt>Entidad</dt><dd>${e(eventLabel(row.entidad))}</dd></div>
          ${includeStore ? `<div><dt>Tienda</dt><dd>${row.idTienda === null ? 'Global' : `#${Number(row.idTienda)}`}</dd></div>` : ''}
        </dl>
        <button type="button" class="secondary" data-audit-detail="${Number(row.idEventoAuditoria)}">Ver detalle</button>
      </article>`).join('');
      return `<div class="table-wrap audit-table"><table>
        <caption class="sr-only">Eventos de auditoria administrativa</caption>
        <thead><tr>${headers}</tr></thead><tbody>${body}</tbody>
      </table></div><div class="audit-mobile-list">${cards}</div>`;
    }

    function query() {
      const form = root.querySelector('[data-audit-filters]');
      const values = new URLSearchParams(new FormData(form));
      for (const [key, value] of [...values.entries()]) {
        if (!String(value).trim()) values.delete(key);
      }
      values.set('page', String(state.page));
      values.set('pageSize', '25');
      return values;
    }

    function wireDetails() {
      root.querySelectorAll('[data-audit-detail]').forEach((button) => {
        button.addEventListener('click', () => openDetail(button.dataset.auditDetail, button));
      });
    }

    async function load() {
      const request = ++state.request;
      const results = root.querySelector('[data-audit-results]');
      const pagination = root.querySelector('[data-audit-pagination]');
      results.setAttribute('aria-busy', 'true');
      results.innerHTML = '<p class="muted" role="status">Cargando eventos...</p>';
      try {
        const data = await api(`${endpoint}?${query()}`);
        if (request !== state.request) return;
        results.innerHTML = tableMarkup(data.resultados, mode === 'admin');
        const page = data.paginacion;
        pagination.innerHTML = `<button type="button" class="secondary" data-audit-previous ${page.hasPreviousPage ? '' : 'disabled'}>Anterior</button>
          <span>Pagina ${Number(page.page)} de ${Number(page.totalPages)} | ${Number(page.total)} eventos</span>
          <button type="button" class="secondary" data-audit-next ${page.hasNextPage ? '' : 'disabled'}>Siguiente</button>`;
        pagination.querySelector('[data-audit-previous]').addEventListener('click', () => {
          state.page -= 1;
          load();
        });
        pagination.querySelector('[data-audit-next]').addEventListener('click', () => {
          state.page += 1;
          load();
        });
        wireDetails();
      } catch (error) {
        if (request !== state.request) return;
        results.innerHTML = `<div class="audit-empty error" role="alert"><strong>No se pudo cargar la auditoria</strong><p>${e(error.message)}</p><button type="button" data-audit-retry>Reintentar</button></div>`;
        results.querySelector('[data-audit-retry]').addEventListener('click', load);
        pagination.innerHTML = '';
      } finally {
        if (request === state.request) results.setAttribute('aria-busy', 'false');
      }
    }

    function payloadMarkup(title, payload) {
      const entries = Object.entries(payload || {});
      if (!entries.length) return '';
      return `<section><h4>${e(title)}</h4><dl class="audit-payload">${
        entries.map(([key, value]) => `<div><dt>${e(eventLabel(key))}</dt><dd>${e(value)}</dd></div>`).join('')
      }</dl></section>`;
    }

    async function openDetail(id, trigger) {
      state.trigger = trigger;
      trigger.disabled = true;
      try {
        const item = await api(`${endpoint}/${encodeURIComponent(id)}`);
        const dialog = document.createElement('dialog');
        dialog.className = 'audit-dialog';
        dialog.setAttribute('aria-labelledby', 'auditDetailTitle');
        dialog.innerHTML = `<div class="audit-dialog-heading">
            <div><p class="eyebrow">Evento de solo lectura</p><h3 id="auditDetailTitle">${e(eventLabel(item.accion))}</h3></div>
            ${resultBadge(item.resultado)}
          </div>
          <dl class="audit-detail-grid">
            <div><dt>Fecha</dt><dd>${e(formatDate(item.creadoEn))}</dd></div>
            <div><dt>Actor</dt><dd>${e(actorLabel(item.actor))}</dd></div>
            <div><dt>Categoria</dt><dd>${e(CATEGORY_LABELS[item.categoria] || item.categoria)}</dd></div>
            <div><dt>Entidad</dt><dd>${e(eventLabel(item.entidad))}</dd></div>
            <div><dt>Referencia</dt><dd>${e(item.referencia || 'No disponible')}</dd></div>
            <div><dt>Resultado</dt><dd>${e(RESULT_LABELS[item.resultado] || item.resultado)}</dd></div>
            ${mode === 'admin' ? `<div><dt>Tienda</dt><dd>${item.idTienda === null ? 'Global' : `#${Number(item.idTienda)}`}</dd></div>` : ''}
          </dl>
          ${payloadMarkup('Valores anteriores', item.anteriores)}
          ${payloadMarkup('Valores posteriores', item.posteriores)}
          ${payloadMarkup('Datos operativos permitidos', item.metadatos)}
          <div class="audit-dialog-actions"><button type="button" data-audit-close>Cerrar</button></div>`;
        document.body.appendChild(dialog);
        state.dialog = dialog;
        dialog.addEventListener('close', () => {
          dialog.remove();
          state.dialog = null;
          state.trigger?.focus();
        }, { once: true });
        dialog.querySelector('[data-audit-close]').addEventListener('click', () => dialog.close());
        dialog.showModal();
        dialog.querySelector('[data-audit-close]').focus();
      } catch (error) {
        const results = root.querySelector('[data-audit-results]');
        results.insertAdjacentHTML('afterbegin', `<p class="audit-inline-error" role="alert">${e(error.message)}</p>`);
      } finally {
        trigger.disabled = false;
      }
    }

    function render() {
      root.innerHTML = `<section class="audit-screen" aria-labelledby="auditTitle">
        <header class="audit-heading">
          <div><p class="eyebrow">Registro inmutable</p><h2 id="auditTitle">Auditoria administrativa</h2>
          <p>Consulta acciones relevantes, rechazos y fallos sin modificar el historial.</p></div>
        </header>
        ${filtersMarkup()}
        <div data-audit-results aria-live="polite"></div>
        <nav class="audit-pagination" data-audit-pagination aria-label="Paginacion de auditoria"></nav>
      </section>`;
      const filters = root.querySelector('[data-audit-filters]');
      filters.addEventListener('submit', (event) => {
        event.preventDefault();
        state.page = 1;
        load();
      });
      filters.addEventListener('reset', () => {
        window.setTimeout(() => {
          state.page = 1;
          load();
        }, 0);
      });
      return load();
    }

    return Object.freeze({ load, render });
  }

  global.AdministrativeAuditUI = Object.freeze({ create });
})(window);
