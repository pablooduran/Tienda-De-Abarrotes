(function customerCreditModule() {
  'use strict';

  const PAYMENT_METHODS = ['efectivo', 'qr', 'transferencia', 'tarjeta', 'otro'];
  const FOLLOWUP_TYPES = ['nota', 'llamada', 'mensaje_enviado_manual', 'compromiso_pago', 'visita'];
  const CHANNELS = ['ninguno', 'whatsapp', 'telefono', 'presencial', 'correo'];
  const TEMPLATE_TYPES = ['recordatorio_previo', 'deuda_vencida', 'confirmacion_pago', 'estado_cuenta'];

  function create(deps) {
    const {
      api, view, modalRoot, getState, hasFeature, escapeHtml: e, money, formatDate,
      showError, showSuccess, newOperationKey, localDateValue, requestAdminPassword,
      refreshCatalogs, secureFetch, errorFromResponse
    } = deps;
    const ui = {
      customerPage: 1,
      collectionPage: 1,
      customerFilters: { estado: 'activos' },
      collectionFilters: {},
      posCustomerId: null,
      posSnapshot: null,
      posConfiguration: null,
      posLoadingCustomerId: null,
      posBalance: 0,
      posRequest: 0,
      collectionRequest: 0,
      collectionSearchTimer: null
    };

    const state = () => getState();
    const can = (code) => hasFeature(code);
    const readOnly = () => Boolean(state().context?.soloLectura);
    const nullable = (value) => {
      const text = String(value ?? '').trim();
      return text === '' ? null : text;
    };
    const booleanValue = (form, name) => Boolean(form.elements[name]?.checked);
    const dateText = (value) => value ? String(value).slice(0, 10) : '';
    const addLocalDays = (days) => {
      const date = new Date();
      date.setDate(date.getDate() + Number(days || 0));
      return localDateValue(date);
    };
    const valueOrUnknown = (value, prefix = '') => value === null || value === undefined || value === ''
      ? 'Sin limite' : `${prefix}${money(value)}`;
    const statusText = (value) => String(value || 'sin_fecha').replaceAll('_', ' ');
    const statusBadge = (value) => `<span class="credit-status status-${e(value || 'sin_fecha')}">${e(statusText(value))}</span>`;
    const option = (value, label, selected) => `<option value="${e(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${e(label)}</option>`;
    function setBusy(button, busy, label = 'Procesando...') {
      if (!button) return;
      if (busy) {
        button.dataset.originalText = button.textContent;
        button.textContent = label;
        button.disabled = true;
      } else {
        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = false;
      }
    }

    function filterQuery(filters, extra = {}) {
      const query = new URLSearchParams();
      Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) query.set(key, value);
      });
      return query;
    }

    function downloadFileName(response, fallback) {
      const disposition = response.headers.get('Content-Disposition') || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      if (encoded) {
        try { return decodeURIComponent(encoded); } catch { /* use the ASCII fallback */ }
      }
      return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
    }

    async function downloadWorkbook(url, button, fallbackName) {
      if (!button || button.disabled) return;
      setBusy(button, true, 'Generando...');
      try {
        const response = await secureFetch(url);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw errorFromResponse(response, body, 'No se pudo generar la exportacion.');
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = downloadFileName(response, fallbackName);
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        await showSuccess('Exportacion generada correctamente.');
      } catch (error) {
        showError(error.message || 'No se pudo generar la exportacion.');
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
    }

    function formError(form, message = '') {
      const target = form.querySelector('[data-form-error]');
      if (!target) return;
      target.textContent = message;
      target.hidden = !message;
      if (message) target.focus();
    }

    function openFormModal({ title, body, submitText = 'Guardar', wide = false, onOpen, onSubmit }) {
      return new Promise((resolve) => {
        const returnFocus = document.activeElement;
        modalRoot.innerHTML = `
          <div class="modal-backdrop">
            <form class="modal ${wide ? 'modal-wide' : ''}" data-credit-modal role="dialog" aria-modal="true" aria-label="${e(title)}">
              <h3>${e(title)}</h3>
              <div class="modal-body">${body}<p class="form-error" data-form-error tabindex="-1" hidden></p></div>
              <div class="modal-actions">
                <button type="button" class="secondary" data-modal-cancel>Cancelar</button>
                <button type="submit" data-modal-submit>${e(submitText)}</button>
              </div>
            </form>
          </div>`;
        const form = modalRoot.querySelector('[data-credit-modal]');
        const close = (result = null) => {
          modalRoot.innerHTML = '';
          returnFocus?.focus?.();
          resolve(result);
        };
        form.querySelector('[data-modal-cancel]').addEventListener('click', () => close());
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const button = form.querySelector('[data-modal-submit]');
          formError(form);
          setBusy(button, true);
          try {
            const result = await onSubmit(form, close);
            if (result !== undefined && result !== false) {
              if (modalRoot.contains(form)) close(result);
              else resolve(result);
            }
          } catch (error) {
            formError(form, error.message || 'No se pudo completar la operacion.');
          } finally {
            if (modalRoot.contains(form)) setBusy(button, false);
          }
        });
        onOpen?.(form, close);
        form.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus();
      });
    }

    async function copyText(text) {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'clipboard-fallback';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }

    function customerFiltersMarkup() {
      const f = ui.customerFilters;
      return `
        <form class="panel credit-filters" id="customerFilters">
          <label>Buscar<input name="texto" type="search" value="${e(f.texto || '')}" placeholder="Nombre, telefono o documento"></label>
          <label>Telefono<input name="telefono" value="${e(f.telefono || '')}"></label>
          <label>Documento<input name="documento" value="${e(f.documento || '')}"></label>
          <label>Estado<select name="estado">${option('activos', 'Activos', f.estado)}${option('ocultos', 'Ocultos', f.estado)}${option('todos', 'Todos', f.estado)}</select></label>
          <label>Fiado<select name="permiteFiado">${option('', 'Todos', f.permiteFiado)}${option('1', 'Permitido', f.permiteFiado)}${option('0', 'Bloqueado', f.permiteFiado)}</select></label>
          <label>Deuda<select name="conDeuda">${option('', 'Todos', f.conDeuda)}${option('1', 'Con deuda', f.conDeuda)}${option('0', 'Sin deuda', f.conDeuda)}</select></label>
          <label>Vencimiento<select name="vencido">${option('', 'Todos', f.vencido)}${option('1', 'Con deuda vencida', f.vencido)}${option('0', 'Sin deuda vencida', f.vencido)}</select></label>
          <div class="credit-filter-actions"><button type="submit">Aplicar</button><button type="button" class="secondary" data-clear-customer-filters>Limpiar</button></div>
        </form>`;
    }

    function customerActions(customer) {
      if (!customer.activo) return `<div class="actions customer-actions">
        <button type="button" class="small secondary" data-customer-view="${customer.idCliente}">Ver ficha</button>
        <button type="button" class="small secondary" data-customer-statement="${customer.idCliente}">Estado de cuenta</button>
        ${!readOnly() ? `<button type="button" class="small" data-customer-restore="${customer.idCliente}">Restaurar cliente</button>` : ''}
      </div>`;
      return `<div class="actions customer-actions">
        <button type="button" class="small secondary" data-customer-view="${customer.idCliente}">Ver ficha</button>
        ${!readOnly() ? `<button type="button" class="small secondary" data-customer-edit="${customer.idCliente}">Editar</button>` : ''}
        ${Number(customer.deudaActual || 0) > 0 && !readOnly() ? `<button type="button" class="small" data-customer-pay="${customer.idCliente}">Registrar pago</button>` : ''}
        <button type="button" class="small secondary" data-customer-statement="${customer.idCliente}">Estado de cuenta</button>
        ${can('recordatorios_fiado') && customer.aceptaRecordatorios ? `<button type="button" class="small secondary" data-customer-whatsapp="${customer.idCliente}">WhatsApp</button>` : ''}
        ${!readOnly() ? `<button type="button" class="small danger" data-customer-hide="${customer.idCliente}">Ocultar cliente</button>` : ''}
      </div>`;
    }

    function customerRowsMarkup(customers) {
      if (!customers.length) return '<div class="panel empty-state"><strong>No hay clientes con estos filtros.</strong><p>Prueba limpiando los filtros o registra un cliente nuevo.</p></div>';
      const desktop = `<div class="panel table-wrap customer-desktop-table"><table><thead><tr>
        <th>Cliente</th><th>Telefono</th><th>Documento</th><th>Deuda</th><th>Vencido</th><th>Limite</th><th>Credito disponible</th><th>Ultima compra</th><th>Estado</th><th>Acciones</th>
      </tr></thead><tbody>${customers.map((customer) => `<tr class="${customer.activo ? '' : 'customer-hidden'}">
        <td><strong>${e(customer.nombre)}</strong>${customer.correo ? `<small>${e(customer.correo)}</small>` : ''}${!customer.activo && customer.eliminadoEn ? `<small>Oculto: ${e(formatDate(customer.eliminadoEn))}</small>` : ''}</td>
        <td>${e(customer.telefono || 'Sin telefono')}</td><td>${e(customer.documentoIdentidad || 'Sin documento')}</td>
        <td>Bs ${money(customer.deudaActual)}</td><td>${Number(customer.deudaVencida || 0) > 0 ? `<strong class="text-danger">Bs ${money(customer.deudaVencida)}</strong>` : 'Bs 0.00'}</td>
        <td>${valueOrUnknown(customer.limiteEfectivo, 'Bs ')}</td><td>${valueOrUnknown(customer.creditoDisponible, 'Bs ')}</td>
        <td>${customer.ultimaCompra ? e(formatDate(customer.ultimaCompra)) : 'Sin compras'}</td><td>${statusBadge(customer.activo ? (customer.permiteFiado ? 'activo' : 'fiado_bloqueado') : 'oculto')}</td>
        <td>${customerActions(customer)}</td></tr>`).join('')}</tbody></table></div>`;
      const mobile = `<div class="customer-mobile-list">${customers.map((customer) => `<article class="customer-card ${customer.activo ? '' : 'customer-hidden'}">
        <header><div><strong>${e(customer.nombre)}</strong><span>${e(customer.telefono || 'Sin telefono')}</span>${!customer.activo && customer.eliminadoEn ? `<span>Oculto: ${e(formatDate(customer.eliminadoEn))}</span>` : ''}</div>${statusBadge(customer.activo ? 'activo' : 'oculto')}</header>
        <dl><div><dt>Deuda</dt><dd>Bs ${money(customer.deudaActual)}</dd></div><div><dt>Vencida</dt><dd>Bs ${money(customer.deudaVencida)}</dd></div><div><dt>Credito disponible</dt><dd>${valueOrUnknown(customer.creditoDisponible, 'Bs ')}</dd></div></dl>
        ${customerActions(customer)}</article>`).join('')}</div>`;
      return desktop + mobile;
    }

    function pagerMarkup(page, limit, total, kind) {
      const pages = Math.max(1, Math.ceil(total / limit));
      return `<div class="panel credit-pagination" aria-label="Paginacion">
        <button type="button" class="secondary" data-${kind}-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
        <span>Pagina ${page} de ${pages} · ${total} registros</span>
        <button type="button" class="secondary" data-${kind}-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Siguiente</button>
      </div>`;
    }

    async function renderCustomers() {
      view.innerHTML = '<div class="panel loading-state">Cargando clientes...</div>';
      try {
        const query = new URLSearchParams({ pagina: ui.customerPage, limite: 20 });
        Object.entries(ui.customerFilters).forEach(([key, value]) => { if (value !== '') query.set(key, value); });
        const data = await api(`/api/clientes?${query}`);
        const customers = data.clientes || data;
        const total = Number(data.total ?? customers.length);
        const summary = data.resumen || {};
        const debt = Number(summary.deudaTotal ?? customers.reduce((sum, item) => sum + Number(item.deudaActual || 0), 0));
        const overdue = Number(summary.clientesVencidos ?? customers.filter((item) => Number(item.deudaVencida || 0) > 0).length);
        const active = Number(summary.clientesActivos ?? customers.filter((item) => item.activo).length);
        const hidden = Number(summary.clientesOcultos ?? customers.filter((item) => !item.activo).length);
        const withDebt = Number(summary.clientesConDeuda ?? customers.filter((item) => Number(item.deudaActual || 0) > 0).length);
        view.innerHTML = `
          <div class="credit-heading"><div><span class="eyebrow">Clientes</span><h3>Relaciones claras, cuentas al dia</h3><p>Consulta deuda, credito y actividad sin perder el historial.</p></div>
            <div class="actions">${!readOnly() ? '<button type="button" data-new-customer>Agregar cliente</button>' : ''}${can('limites_credito') ? '<button type="button" class="secondary" data-credit-config>Configurar credito</button>' : ''}${can('exportacion_clientes_fiados') ? `<button type="button" class="secondary" data-export-customers ${readOnly() ? 'disabled title="La suscripcion debe estar activa para exportar."' : ''}>Exportar clientes</button>` : ''}</div></div>
          <div class="cards customer-summary-cards"><article class="card"><span>Clientes activos</span><strong>${active}</strong></article>
            <article class="card"><span>Clientes ocultos</span><strong>${hidden}</strong></article>
            <article class="card"><span>Clientes con deuda</span><strong>${withDebt}</strong></article>
            <article class="card"><span>Deuda total</span><strong>Bs ${money(debt)}</strong></article>
            <article class="card"><span>Clientes vencidos</span><strong>${overdue}</strong></article>
            <article class="card"><span>Resultados filtrados</span><strong>${total}</strong></article></div>
          ${customerFiltersMarkup()}<div id="customerResults">${customerRowsMarkup(customers)}</div>${pagerMarkup(Number(data.pagina || ui.customerPage), Number(data.limite || 20), total, 'customer')}
          ${readOnly() ? '<div class="panel readonly-note"><strong>Modo de solo lectura.</strong><p>Puedes consultar perfiles, deuda y estados de cuenta. Las altas, ediciones y cobros estan deshabilitados hasta reactivar la suscripcion.</p></div>' : ''}`;
        wireCustomerView(customers);
      } catch (error) {
        view.innerHTML = `<div class="panel error-state"><strong>No se pudieron cargar los clientes.</strong><p>${e(error.message)}</p><button type="button" data-retry-customers>Reintentar</button></div>`;
        view.querySelector('[data-retry-customers]')?.addEventListener('click', renderCustomers);
      }
    }

    function wireCustomerView(customers) {
      view.querySelector('[data-new-customer]')?.addEventListener('click', () => openCustomerForm());
      view.querySelector('[data-credit-config]')?.addEventListener('click', openCreditConfiguration);
      view.querySelector('[data-export-customers]:not([disabled])')?.addEventListener('click', (event) => {
        const query = filterQuery(ui.customerFilters);
        downloadWorkbook(
          `/api/clientes/exportacion.xlsx?${query}`,
          event.currentTarget,
          `clientes_${localDateValue()}.xlsx`
        );
      });
      view.querySelector('#customerFilters')?.addEventListener('submit', (event) => {
        event.preventDefault();
        ui.customerFilters = Object.fromEntries(new FormData(event.currentTarget).entries());
        ui.customerPage = 1;
        renderCustomers();
      });
      view.querySelector('[data-clear-customer-filters]')?.addEventListener('click', () => {
        ui.customerFilters = { estado: 'activos' };
        ui.customerPage = 1;
        renderCustomers();
      });
      view.querySelectorAll('[data-customer-page]').forEach((button) => button.addEventListener('click', () => {
        ui.customerPage = Number(button.dataset.customerPage);
        renderCustomers();
      }));
      view.querySelectorAll('[data-customer-view]').forEach((button) => button.addEventListener('click', () => openCustomerProfile(button.dataset.customerView)));
      view.querySelectorAll('[data-customer-edit]').forEach((button) => button.addEventListener('click', () => openCustomerForm(customers.find((item) => String(item.idCliente) === button.dataset.customerEdit))));
      view.querySelectorAll('[data-customer-pay]').forEach((button) => button.addEventListener('click', () => openPayment({ idCliente: button.dataset.customerPay })));
      view.querySelectorAll('[data-customer-statement]').forEach((button) => button.addEventListener('click', () => openStatement(button.dataset.customerStatement)));
      view.querySelectorAll('[data-customer-whatsapp]').forEach((button) => button.addEventListener('click', () => openWhatsApp({ idCliente: button.dataset.customerWhatsapp })));
      view.querySelectorAll('[data-customer-hide]').forEach((button) => button.addEventListener('click', () => changeCustomerState(
        customers.find((item) => String(item.idCliente) === button.dataset.customerHide), false, button
      )));
      view.querySelectorAll('[data-customer-restore]').forEach((button) => button.addEventListener('click', () => changeCustomerState(
        customers.find((item) => String(item.idCliente) === button.dataset.customerRestore), true, button
      )));
    }

    async function changeCustomerState(customer, restore, button) {
      if (!customer || readOnly() || button?.disabled) return;
      const debt = Number(customer.deudaActual || 0);
      const action = restore ? 'restaurar' : 'ocultar';
      const debtNotice = debt > 0
        ? ` Conserva una deuda de Bs ${money(debt)}, que seguira visible y podra cobrarse.`
        : '';
      const password = await requestAdminPassword(
        restore
          ? `¿Deseas restaurar a ${customer.nombre}? Recuperara el acceso normal sin alterar su historial.${debtNotice}`
          : `¿Deseas ocultar a ${customer.nombre}? No se eliminara su historial y no se modificaran ventas, fiados o pagos.${debtNotice}`
      );
      if (!password) return;
      setBusy(button, true, restore ? 'Restaurando...' : 'Ocultando...');
      try {
        const result = await api(`/api/clientes/${customer.idCliente}${restore ? '/restaurar' : ''}`, {
          method: restore ? 'PATCH' : 'DELETE',
          body: JSON.stringify({ passwordAdministrador: password })
        });
        modalRoot.innerHTML = '';
        ui.customerPage = 1;
        await refreshCatalogs();
        await renderCustomers();
        await showSuccess(result.message || `Cliente ${restore ? 'restaurado' : 'ocultado'}.`);
      } catch (error) {
        showError(error.message || `No se pudo ${action} el cliente.`);
      } finally {
        if (button?.isConnected) setBusy(button, false);
      }
    }

    function customerFormBody(customer = {}) {
      const advanced = can('limites_credito');
      return `<div class="customer-form-sections">
        <section><h4>Datos basicos</h4><div class="form-grid">
          <label>Nombre<input name="nombre" required maxlength="120" value="${e(customer.nombre || '')}"></label>
          <label>Telefono<input name="telefono" maxlength="30" value="${e(customer.telefono || '')}"></label>
          <label>Telefono alternativo<input name="telefonoAlternativo" maxlength="30" value="${e(customer.telefonoAlternativo || '')}"></label>
          <label>Documento<input name="documentoIdentidad" maxlength="50" value="${e(customer.documentoIdentidad || '')}"></label>
          <label>Correo<input name="correo" type="email" maxlength="160" value="${e(customer.correo || '')}"></label>
          <label class="wide">Direccion<input name="direccion" maxlength="255" value="${e(customer.direccion || '')}"></label>
        </div></section>
        <section><h4>Credito</h4><div class="form-grid">
          <label class="check"><input name="permiteFiado" type="checkbox" ${customer.permiteFiado !== false ? 'checked' : ''}> Permitir nuevos fiados</label>
          ${advanced ? `<label>Limite de credito<input name="limiteCredito" type="number" min="0" step="0.01" value="${e(customer.limiteCredito ?? '')}" placeholder="Sin limite individual"></label><label>Dias de credito<input name="diasCreditoDefault" type="number" min="1" max="365" value="${e(customer.diasCreditoDefault ?? '')}" placeholder="Usar valor de tienda"></label>` : ''}
          <label class="check"><input name="aceptaRecordatorios" type="checkbox" ${customer.aceptaRecordatorios !== false ? 'checked' : ''}> Acepta recordatorios</label>
        </div>${advanced ? '' : '<p class="plan-note">Los limites y plazos personalizados estan disponibles en el plan avanzado.</p>'}</section>
        <section><h4>Comunicacion</h4><div class="form-grid">
          <label>Canal preferido<select name="canalPreferido">${CHANNELS.map((item) => option(item, statusText(item), customer.canalPreferido || 'ninguno')).join('')}</select></label>
          <label>Horario preferido<input name="horarioPreferido" maxlength="120" value="${e(customer.horarioPreferido || '')}"></label>
          <label class="wide">Notas<textarea name="notas" maxlength="1000" rows="3">${e(customer.notas || '')}</textarea></label>
        </div></section>
      </div>`;
    }

    async function openCustomerForm(customer = null) {
      if (readOnly()) return showError('La cuenta esta en modo de solo lectura.');
      await openFormModal({
        title: customer ? 'Editar cliente' : 'Agregar cliente',
        body: customerFormBody(customer || {}), wide: true, submitText: customer ? 'Guardar cambios' : 'Crear cliente',
        onSubmit: async (form) => {
          const fd = new FormData(form);
          const payload = {
            nombre: nullable(fd.get('nombre')),
            telefono: nullable(fd.get('telefono')),
            telefonoAlternativo: nullable(fd.get('telefonoAlternativo')),
            documentoIdentidad: nullable(fd.get('documentoIdentidad')),
            correo: nullable(fd.get('correo')),
            direccion: nullable(fd.get('direccion')),
            canalPreferido: fd.get('canalPreferido') || 'ninguno',
            horarioPreferido: nullable(fd.get('horarioPreferido')),
            notas: nullable(fd.get('notas'))
          };
          if (!payload.nombre) throw new Error('El nombre es obligatorio.');
          if (can('limites_credito')) {
            payload.limiteCredito = nullable(fd.get('limiteCredito'));
            payload.diasCreditoDefault = nullable(fd.get('diasCreditoDefault'));
          }
          payload.permiteFiado = booleanValue(form, 'permiteFiado');
          payload.aceptaRecordatorios = booleanValue(form, 'aceptaRecordatorios');
          const result = await api(`/api/clientes${customer ? `/${customer.idCliente}` : ''}`, {
            method: customer ? 'PATCH' : 'POST', body: JSON.stringify(payload)
          });
          if (result.advertencias?.length) await showSuccess(`Cliente guardado. ${result.advertencias.join(' ')}`);
          else await showSuccess('Cliente guardado.');
          await renderCustomers();
          return true;
        }
      });
    }

    function historyNotice(metadata) {
      if (!metadata) return '';
      const shown = Number(metadata.mostrados || 0);
      const total = Number(metadata.total || 0);
      const limit = Number(metadata.limite || 0);
      return `<p class="hint history-notice">Mostrando ${shown} de ${total} registros recientes${limit ? ` (limite ${limit})` : ''}.</p>`;
    }

    function profileTabBody(data, tab) {
      const customer = data.cliente;
      if (tab === 'resumen') return `<div class="cards profile-summary"><article class="card"><span>Deuda total</span><strong>Bs ${money(customer.deudaActual)}</strong></article><article class="card"><span>Deuda vencida</span><strong>Bs ${money(customer.deudaVencida)}</strong></article><article class="card"><span>Limite efectivo</span><strong>${valueOrUnknown(customer.limiteEfectivo, 'Bs ')}</strong></article><article class="card"><span>Credito disponible</span><strong>${valueOrUnknown(customer.creditoDisponible, 'Bs ')}</strong></article></div><dl class="profile-details"><div><dt>Ultima compra</dt><dd>${data.compras?.[0]?.fecha ? e(formatDate(data.compras[0].fecha)) : 'Sin compras'}</dd></div><div><dt>Ultimo pago</dt><dd>${data.pagos?.[0]?.fechaPago ? e(formatDate(data.pagos[0].fechaPago)) : 'Sin pagos'}</dd></div><div><dt>Canal preferido</dt><dd>${e(statusText(customer.canalPreferido))}</dd></div><div><dt>Recordatorios</dt><dd>${customer.aceptaRecordatorios ? 'Aceptados' : 'No aceptados'}</dd></div></dl>`;
      if (tab === 'compras') return historyNotice(data.historial?.compras) + listOrEmpty(data.compras, (row) => `<article class="timeline-row"><div><strong>${e(row.codigoComprobante || `Venta #${row.idVenta}`)}</strong><span>${e(formatDate(row.fecha))}</span></div><strong>Bs ${money(row.total)}</strong></article>`, 'No hay compras registradas.');
      if (tab === 'fiados') return historyNotice(data.historial?.fiados) + listOrEmpty(data.fiados, (row) => `<article class="timeline-row"><div><strong>Fiado #${row.idFiado}</strong><span>${e(formatDate(row.fechaInicio))} · vence ${e(dateText(row.fechaVencimiento) || 'sin fecha')} · promesa ${e(dateText(row.fechaPrometidaPago) || 'sin promesa')}</span></div><div><strong>Bs ${money(row.saldoPendiente)}</strong>${statusBadge(row.estadoCobranza || row.estado)}</div></article>`, 'No hay fiados registrados.');
      if (tab === 'pagos') return historyNotice(data.historial?.pagos) + listOrEmpty(data.pagos, (row) => `<article class="timeline-row"><div><strong>Pago a fiado #${row.idFiado}</strong><span>${e(formatDate(row.fechaPago))} · ${e(statusText(row.metodoPago))} · ${e(row.administrador || 'Sistema')}</span></div><strong>Bs ${money(row.monto)}</strong></article>`, 'No hay pagos registrados.');
      if (tab === 'seguimiento') return data.permisos?.seguimientoCobranza
        ? historyNotice(data.historial?.seguimientos) + listOrEmpty(data.seguimientos, (row) => `<article class="timeline-row"><div><strong>${e(statusText(row.tipo))}</strong><span>${e(formatDate(row.creadoEn))} · ${e(statusText(row.canal))} · ${e(row.administrador || 'Sistema')}</span><p>${e(row.detalle)}</p></div>${row.fechaCompromiso ? `<strong>${e(dateText(row.fechaCompromiso))}</strong>` : ''}</article>`, 'No hay seguimientos registrados.')
        : '<div class="plan-note">El seguimiento de cobranza esta disponible en el plan avanzado.</div>';
      return '';
    }

    function listOrEmpty(rows, render, empty) {
      return rows?.length ? `<div class="timeline-list">${rows.map(render).join('')}</div>` : `<div class="empty-state"><p>${e(empty)}</p></div>`;
    }

    async function openCustomerProfile(idCliente) {
      try {
        const returnFocus = document.activeElement;
        const [data, debts] = await Promise.all([
          api(`/api/clientes/${idCliente}`),
          api(`/api/fiados?cliente=${encodeURIComponent(idCliente)}&pagina=1&limite=20`)
        ]);
        data.fiados = debts.fiados || debts;
        data.historial = data.historial || {};
        data.historial.fiados = {
          mostrados: data.fiados.length,
          total: Number(debts.total || data.fiados.length),
          limite: Number(debts.pageSize || debts.limite || 20),
          truncado: Number(debts.total || data.fiados.length) > data.fiados.length
        };
        const customer = data.cliente;
        const tabs = ['resumen', 'compras', 'fiados', 'pagos'];
        if (data.permisos?.seguimientoCobranza) tabs.push('seguimiento');
        modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal modal-wide customer-profile-modal" role="dialog" aria-modal="true" aria-label="Ficha de ${e(customer.nombre)}">
          <div class="profile-heading"><div><span class="eyebrow">Ficha de cliente</span><h3>${e(customer.nombre)}</h3><p>${e(customer.telefono || 'Sin telefono')} · ${e(customer.documentoIdentidad || 'Sin documento')}</p></div>${statusBadge(customer.activo ? 'activo' : 'oculto')}</div>
          ${customer.activo ? '' : `<div class="hidden-customer-note"><strong>Cliente oculto.</strong><p>Su historial y sus deudas se conservan${customer.eliminadoEn ? ` desde ${e(formatDate(customer.eliminadoEn))}` : ''}. Restauralo antes de editarlo o usarlo en una venta nueva.</p></div>`}
          <div class="profile-actions"><button type="button" class="secondary" data-profile-statement>Estado de cuenta</button>${customer.activo && Number(customer.deudaActual) > 0 && !readOnly() ? '<button type="button" data-profile-pay>Registrar pago</button>' : ''}${customer.activo && can('recordatorios_fiado') && customer.aceptaRecordatorios ? '<button type="button" class="secondary" data-profile-whatsapp>WhatsApp</button>' : ''}${!customer.activo && !readOnly() ? '<button type="button" data-profile-restore>Restaurar cliente</button>' : ''}</div>
          <nav class="profile-tabs" aria-label="Secciones de la ficha">${tabs.map((tab) => `<button type="button" class="secondary" data-profile-tab="${tab}">${e(statusText(tab))}</button>`).join('')}</nav>
          <div class="modal-body" data-profile-content>${profileTabBody(data, 'resumen')}</div>
          <div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Cerrar</button></div>
        </section></div>`;
        const close = () => { modalRoot.innerHTML = ''; returnFocus?.focus?.(); };
        modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', close);
        modalRoot.querySelectorAll('[data-profile-tab]').forEach((button) => button.addEventListener('click', () => {
          modalRoot.querySelectorAll('[data-profile-tab]').forEach((item) => item.classList.toggle('active', item === button));
          modalRoot.querySelector('[data-profile-content]').innerHTML = profileTabBody(data, button.dataset.profileTab);
        }));
        modalRoot.querySelector('[data-profile-tab="resumen"]').classList.add('active');
        modalRoot.querySelector('[data-profile-statement]').addEventListener('click', () => openStatement(idCliente));
        modalRoot.querySelector('[data-profile-pay]')?.addEventListener('click', () => openPayment({ idCliente }));
        modalRoot.querySelector('[data-profile-whatsapp]')?.addEventListener('click', () => openWhatsApp({ idCliente }));
        modalRoot.querySelector('[data-profile-restore]')?.addEventListener('click', (event) => changeCustomerState(customer, true, event.currentTarget));
      } catch (error) { showError(error.message); }
    }

    function paymentFields(debt, customer, customerId, operationKey) {
      return `<input type="hidden" name="claveOperacion" value="${e(operationKey)}"><input type="hidden" name="idCliente" value="${e(customerId || debt?.idCliente || '')}">
        <div class="payment-balance"><span>${debt ? 'Saldo actual' : 'Deuda total del cliente'}</span><strong>Bs ${money(debt?.saldoPendiente ?? customer?.deudaActual)}</strong></div>
        ${debt ? '' : '<p class="hint">Se aplicara primero a las deudas mas antiguas.</p>'}
        <div class="form-grid">
          <label>Monto<input name="monto" type="number" min="0.01" step="0.01" required ${debt ? `max="${e(debt.saldoPendiente)}"` : ''}></label>
          <label>Metodo<select name="metodoPago" required>${PAYMENT_METHODS.map((item) => option(item, statusText(item), 'efectivo')).join('')}</select></label>
          <label data-cash-received>Monto recibido<input name="montoRecibido" type="number" min="0" step="0.01"></label>
          <label>Cambio<input name="cambioVisual" readonly value="0.00"></label>
          <label>Referencia<input name="referencia" maxlength="160"></label>
          <label class="wide">Observacion<textarea name="observacion" maxlength="1000"></textarea></label>
        </div><div class="payment-key-note">La operacion conserva la misma clave durante un reintento y evita cobros duplicados.</div>`;
    }

    async function openPayment({ idFiado = null, idCliente = null } = {}) {
      if (readOnly()) return showError('La suscripcion esta inactiva. Puedes consultar la deuda, pero no registrar pagos hasta renovarla.');
      let debt = null;
      let customer = null;
      try {
        if (idFiado) debt = (await api(`/api/fiados/${idFiado}`)).fiado;
        const customerId = idCliente || debt?.idCliente;
        if (customerId) customer = (await api(`/api/clientes/${customerId}/resumen`)).cliente;
        if (!customerId) throw new Error('Selecciona un cliente o una deuda para registrar el pago.');
        const operationKey = `cobro-ui:${newOperationKey()}`;
        await openFormModal({
          title: debt ? `Pago de fiado #${debt.idFiado}` : `Pago acumulado de ${customer.nombre}`,
          body: paymentFields(debt, customer, customerId, operationKey), wide: true, submitText: 'Registrar pago',
          onOpen: (form) => {
            const method = form.elements.metodoPago;
            const amount = form.elements.monto;
            const received = form.elements.montoRecibido;
            const change = form.elements.cambioVisual;
            const sync = () => {
              const cash = method.value === 'efectivo';
              form.querySelector('[data-cash-received]').hidden = !cash;
              received.disabled = !cash;
              const applied = Math.max(0, Number(amount.value || 0));
              const tendered = Math.max(0, Number(received.value || 0));
              change.value = money(cash ? Math.max(0, tendered - applied) : 0);
            };
            method.addEventListener('change', sync);
            amount.addEventListener('input', sync);
            received.addEventListener('input', sync);
            sync();
          },
          onSubmit: async (form) => {
            const fd = new FormData(form);
            const amount = Number(fd.get('monto'));
            if (!(amount > 0)) throw new Error('El monto debe ser mayor a cero.');
            if (debt && amount > Number(debt.saldoPendiente)) throw new Error('El pago no puede superar el saldo.');
            if (!debt && amount > Number(customer.deudaActual)) throw new Error('El pago no puede superar la deuda total del cliente.');
            const method = fd.get('metodoPago');
            const received = method === 'efectivo' ? Number(fd.get('montoRecibido') || amount) : null;
            if (method === 'efectivo' && received < amount) throw new Error('El monto recibido no alcanza para el pago.');
            const payload = {
              monto: money(amount), metodoPago: method, montoRecibido: received === null ? null : money(received),
              referencia: nullable(fd.get('referencia')), observacion: nullable(fd.get('observacion')),
              claveOperacion: fd.get('claveOperacion')
            };
            if (!debt) payload.idCliente = customerId;
            const result = await api(debt ? `/api/fiados/${debt.idFiado}/pagos` : '/api/pagos-fiado/cliente', {
              method: 'POST', body: JSON.stringify(payload)
            });
            const distribution = result.aplicaciones?.length
              ? ` Distribucion: ${result.aplicaciones.map((item) => `fiado #${item.idFiado}: Bs ${money(item.monto)}`).join(', ')}.` : '';
            await showSuccess(`${result.message || 'Cobro registrado.'}${distribution}`);
            if (document.getElementById('collectionResults')) await renderCollections();
            return result;
          }
        });
      } catch (error) { showError(error.message); }
    }

    function collectionFiltersMarkup() {
      const f = ui.collectionFilters;
      return `<form class="panel credit-filters collection-filters" id="collectionFilters">
        <label>Buscar<input name="busqueda" type="search" value="${e(f.busqueda || '')}" placeholder="Cliente o telefono"></label><label>Cliente<select name="cliente"><option value="">Todos</option>${state().clientes.map((item) => option(item.idCliente, item.nombre, f.cliente)).join('')}</select></label>
        <label>Estado<select name="estado">${['', 'vencido', 'vence_hoy', 'proximo_a_vencer', 'al_dia', 'sin_fecha', 'pagado'].map((item) => option(item, item ? statusText(item) : 'Todos', f.estado)).join('')}</select></label>
        <label>Desde<input name="venceDesde" type="date" value="${e(f.venceDesde || '')}"></label><label>Hasta<input name="venceHasta" type="date" value="${e(f.venceHasta || '')}"></label>
        <label>Saldo minimo<input name="saldoMinimo" type="number" min="0" step="0.01" value="${e(f.saldoMinimo || '')}"></label><label>Saldo maximo<input name="saldoMaximo" type="number" min="0" step="0.01" value="${e(f.saldoMaximo || '')}"></label>
        <div class="credit-filter-actions"><button type="submit">Aplicar</button><button type="button" class="secondary" data-clear-collection-filters>Limpiar</button></div>
      </form>`;
    }

    function collectionActions(row) {
      return `<div class="actions">
        ${Number(row.saldoPendiente || 0) > 0 && !readOnly() ? `<button type="button" class="small" data-debt-pay="${row.idFiado}">Registrar pago</button>` : ''}
        ${Number(row.saldoPendiente || 0) > 0 && !readOnly() ? `<button type="button" class="small secondary" data-customer-pay-accum="${row.idCliente}">Pago acumulado</button>` : ''}
        ${row.clienteActivo && Number(row.saldoPendiente || 0) > 0 && can('seguimiento_cobranza') && !readOnly() ? `<button type="button" class="small secondary" data-debt-promise="${row.idFiado}">Registrar promesa</button>` : ''}
        ${row.clienteActivo && can('seguimiento_cobranza') && !readOnly() ? `<button type="button" class="small secondary" data-debt-followup="${row.idFiado}" data-customer="${row.idCliente}">Seguimiento</button>` : ''}
        ${row.clienteActivo && can('recordatorios_fiado') && row.aceptaRecordatorios !== false ? `<button type="button" class="small secondary" data-debt-whatsapp="${row.idFiado}" data-customer="${row.idCliente}">WhatsApp</button>` : ''}
        <button type="button" class="small secondary" data-debt-statement="${row.idCliente}">Estado de cuenta</button>
        <button type="button" class="small secondary" data-debt-customer="${row.idCliente}">Ver cliente</button>
      </div>`;
    }

    function collectionRowsMarkup(rows) {
      if (!rows.length) return '<div class="panel empty-state"><strong>No hay cuentas en este estado.</strong><p>Los filtros actuales no devolvieron resultados.</p></div>';
      return `<div class="panel collection-desktop-table table-wrap"><table><thead><tr><th>Cliente</th><th>Telefono</th><th>Saldo</th><th>Vencimiento</th><th>Promesa</th><th>Estado</th><th>Tiempo</th><th>Acciones</th></tr></thead><tbody>${rows.map((row) => `<tr>
        <td><strong>${e(row.cliente)}</strong>${row.clienteActivo ? '' : `<small>${statusBadge('oculto')}</small>`}</td><td>${e(row.telefono || 'Sin telefono')}</td><td>Bs ${money(row.saldoPendiente)}</td><td>${e(dateText(row.fechaVencimiento) || 'Sin fecha')}</td><td>${e(dateText(row.fechaPrometidaPago) || 'Sin promesa')}</td><td>${statusBadge(row.estadoCobranza || row.estado)}</td><td>${row.diasAtraso ? `${e(row.diasAtraso)} dias de atraso` : row.diasRestantes !== null && row.diasRestantes !== undefined ? `${e(row.diasRestantes)} dias restantes` : 'Sin calculo'}</td><td>${collectionActions(row)}</td></tr>`).join('')}</tbody></table></div>
        <div class="collection-mobile-list">${rows.map((row) => `<article class="collection-card ${row.clienteActivo ? '' : 'customer-hidden'}"><header><div><strong>${e(row.cliente)}</strong><span>${e(row.telefono || 'Sin telefono')}</span>${row.clienteActivo ? '' : '<span>Cliente oculto</span>'}</div>${statusBadge(row.estadoCobranza || row.estado)}</header><dl><div><dt>Saldo</dt><dd>Bs ${money(row.saldoPendiente)}</dd></div><div><dt>Vencimiento</dt><dd>${e(dateText(row.fechaVencimiento) || 'Sin fecha')}</dd></div><div><dt>Promesa</dt><dd>${e(dateText(row.fechaPrometidaPago) || 'Sin promesa')}</dd></div></dl>${collectionActions(row)}</article>`).join('')}</div>`;
    }

    async function renderCollections(focus = null) {
      if (focus?.idCliente) {
        ui.collectionFilters.cliente = focus.idCliente;
        ui.collectionPage = 1;
      }
      const request = ++ui.collectionRequest;
      view.innerHTML = '<div class="panel loading-state">Cargando cobranza...</div>';
      try {
        const advancedAlerts = can('recordatorios_fiado');
        const query = new URLSearchParams({ pagina: ui.collectionPage, limite: 20 });
        Object.entries(ui.collectionFilters).forEach(([key, value]) => { if (value !== '') query.set(key, value); });
        const endpoint = advancedAlerts && ui.collectionFilters.estado !== 'pagado'
          ? '/api/cobranza/alertas'
          : '/api/fiados';
        const data = await api(`${endpoint}?${query}`);
        if (request !== ui.collectionRequest) return;
        const rows = data.alertas || data.fiados || data;
        const summary = data.resumen || {};
        const total = Number(data.total || rows.length);
        view.innerHTML = `<div class="credit-heading"><div><span class="eyebrow">Cobranza</span><h3>Deudas y compromisos en un solo lugar</h3><p>Los cobros se registran sin volver a afectar inventario.</p></div><div class="actions">${can('limites_credito') ? '<button type="button" class="secondary" data-credit-config>Configurar credito</button>' : ''}${can('exportacion_clientes_fiados') ? `<button type="button" class="secondary" data-export-debts ${readOnly() ? 'disabled title="La suscripcion debe estar activa para exportar."' : ''}>Exportar fiados</button>` : ''}</div></div>
          <div class="cards collection-summary-cards"><article class="card"><span>Deuda total filtrada</span><strong>Bs ${money(summary.deudaTotal || 0)}</strong></article><article class="card"><span>Vencidos filtrados</span><strong>${Number(summary.vencidos || 0)}</strong></article><article class="card"><span>Vence hoy</span><strong>${Number(summary.venceHoy || 0)}</strong></article><article class="card"><span>Proximos</span><strong>${Number(summary.proximos || 0)}</strong></article><article class="card"><span>Sin fecha</span><strong>${Number(summary.sinFecha || 0)}</strong></article></div>
          ${advancedAlerts ? '' : '<div class="panel plan-note"><strong>Alertas y WhatsApp disponibles en plan avanzado.</strong><p>El pago y consulta de deuda existente siguen disponibles.</p></div>'}
          ${readOnly() ? '<div class="panel plan-note"><strong>Suscripcion inactiva: solo consulta.</strong><p>Puedes revisar clientes y deuda historica, pero no registrar pagos ni cambios hasta renovar.</p></div>' : ''}
          ${collectionFiltersMarkup()}<p class="hint collection-page-count">Mostrando ${rows.length} de ${total} resultados filtrados.</p><div id="collectionResults">${collectionRowsMarkup(rows)}</div>${pagerMarkup(Number(data.page || data.pagina || ui.collectionPage), Number(data.pageSize || data.limite || 20), total, 'collection')}`;
        wireCollectionView(rows);
      } catch (error) {
        if (request !== ui.collectionRequest) return;
        view.innerHTML = `<div class="panel error-state"><strong>No se pudo cargar la cobranza.</strong><p>${e(error.message)}</p><button type="button" data-retry-collections>Reintentar</button></div>`;
        view.querySelector('[data-retry-collections]')?.addEventListener('click', () => renderCollections(focus));
      }
    }

    function wireCollectionView(rows) {
      view.querySelector('[data-credit-config]')?.addEventListener('click', openCreditConfiguration);
      view.querySelector('[data-export-debts]:not([disabled])')?.addEventListener('click', (event) => {
        const alertListing = can('recordatorios_fiado') && ui.collectionFilters.estado !== 'pagado';
        const query = filterQuery(ui.collectionFilters, alertListing ? { soloAbiertos: '1' } : {});
        downloadWorkbook(
          `/api/fiados/exportacion.xlsx?${query}`,
          event.currentTarget,
          `fiados_${localDateValue()}.xlsx`
        );
      });
      const filterForm = view.querySelector('#collectionFilters');
      filterForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        clearTimeout(ui.collectionSearchTimer);
        ui.collectionFilters = Object.fromEntries(new FormData(event.currentTarget).entries());
        ui.collectionPage = 1;
        renderCollections();
      });
      filterForm?.elements.busqueda?.addEventListener('input', () => {
        clearTimeout(ui.collectionSearchTimer);
        ui.collectionRequest += 1;
        ui.collectionSearchTimer = setTimeout(() => {
          if (!view.contains(filterForm)) return;
          ui.collectionFilters = Object.fromEntries(new FormData(filterForm).entries());
          ui.collectionPage = 1;
          renderCollections();
        }, 350);
      });
      view.querySelector('[data-clear-collection-filters]')?.addEventListener('click', () => {
        clearTimeout(ui.collectionSearchTimer);
        ui.collectionFilters = {};
        ui.collectionPage = 1;
        renderCollections();
      });
      view.querySelectorAll('[data-collection-page]').forEach((button) => button.addEventListener('click', () => { ui.collectionPage = Number(button.dataset.collectionPage); renderCollections(); }));
      view.querySelectorAll('[data-debt-pay]').forEach((button) => button.addEventListener('click', () => openPayment({ idFiado: button.dataset.debtPay })));
      view.querySelectorAll('[data-customer-pay-accum]').forEach((button) => button.addEventListener('click', () => openPayment({ idCliente: button.dataset.customerPayAccum })));
      view.querySelectorAll('[data-debt-promise]').forEach((button) => button.addEventListener('click', () => openPromise(rows.find((row) => String(row.idFiado) === button.dataset.debtPromise))));
      view.querySelectorAll('[data-debt-followup]').forEach((button) => button.addEventListener('click', () => openFollowup({ idCliente: button.dataset.customer, idFiado: button.dataset.debtFollowup })));
      view.querySelectorAll('[data-debt-whatsapp]').forEach((button) => button.addEventListener('click', () => openWhatsApp({ idCliente: button.dataset.customer, idFiado: button.dataset.debtWhatsapp })));
      view.querySelectorAll('[data-debt-statement]').forEach((button) => button.addEventListener('click', () => openStatement(button.dataset.debtStatement)));
      view.querySelectorAll('[data-debt-customer]').forEach((button) => button.addEventListener('click', () => openCustomerProfile(button.dataset.debtCustomer)));
    }

    async function openPromise(debt) {
      if (!debt || readOnly()) return;
      await openFormModal({
        title: `Promesa de pago de ${debt.cliente}`,
        body: `<div class="promise-context"><span>Vencimiento original<strong>${e(dateText(debt.fechaVencimiento) || 'Sin fecha')}</strong></span><span>Promesa vigente<strong>${e(dateText(debt.fechaPrometidaPago) || 'Sin promesa')}</strong></span>${statusBadge(debt.estadoCobranza)}</div>
          <div class="form-grid"><label>Fecha prometida<input name="fechaPrometidaPago" type="date" min="${e(localDateValue())}" required value="${e(dateText(debt.fechaPrometidaPago))}"></label><label>Canal<select name="canal">${CHANNELS.map((item) => option(item, statusText(item), 'telefono')).join('')}</select></label>${debt.fechaPrometidaPago ? '<label class="check"><input name="limpiarFechaPrometida" type="checkbox"> Quitar la promesa vigente</label>' : ''}<label class="wide">Detalle o motivo<textarea name="detalle" required maxlength="2000"></textarea></label></div>`,
        submitText: 'Guardar promesa',
        onOpen: (form) => form.elements.limpiarFechaPrometida?.addEventListener('change', () => {
          form.elements.fechaPrometidaPago.disabled = form.elements.limpiarFechaPrometida.checked;
          form.elements.fechaPrometidaPago.required = !form.elements.limpiarFechaPrometida.checked;
        }),
        onSubmit: async (form) => {
          const fd = new FormData(form);
          const clear = booleanValue(form, 'limpiarFechaPrometida');
          const payload = clear
            ? { limpiarFechaPrometida: true, detalle: nullable(fd.get('detalle')), canal: fd.get('canal') }
            : { fechaPrometidaPago: fd.get('fechaPrometidaPago'), detalle: nullable(fd.get('detalle')), canal: fd.get('canal') };
          await api(`/api/fiados/${debt.idFiado}/fecha-prometida`, { method: 'PATCH', body: JSON.stringify(payload) });
          await showSuccess(clear ? 'Promesa retirada. El motivo quedo en seguimiento.' : 'Promesa registrada. El vencimiento original se conserva.');
          await renderCollections();
          return true;
        }
      });
    }

    async function openFollowup({ idCliente, idFiado = null, presetType = 'nota' }) {
      if (!can('seguimiento_cobranza') || readOnly()) return;
      await openFormModal({
        title: 'Registrar seguimiento',
        body: `<div class="form-grid"><label>Tipo<select name="tipo">${FOLLOWUP_TYPES.map((item) => option(item, statusText(item), presetType)).join('')}</select></label><label>Canal<select name="canal">${CHANNELS.map((item) => option(item, statusText(item), 'ninguno')).join('')}</select></label><label data-commitment-date hidden>Fecha de compromiso<input name="fechaCompromiso" type="date" min="${e(localDateValue())}"></label><label class="wide">Detalle<textarea name="detalle" maxlength="2000" required></textarea></label></div><p class="hint">El historial es inmutable. Mensaje enviado manualmente solo debe elegirse despues de confirmar la accion fuera del sistema.</p>`,
        submitText: 'Registrar seguimiento',
        onOpen: (form) => {
          const sync = () => { const required = form.elements.tipo.value === 'compromiso_pago'; form.querySelector('[data-commitment-date]').hidden = !required; form.elements.fechaCompromiso.required = required; };
          form.elements.tipo.addEventListener('change', sync); sync();
        },
        onSubmit: async (form) => {
          const fd = new FormData(form);
          await api('/api/cobranza/seguimientos', { method: 'POST', body: JSON.stringify({ idCliente, idFiado, tipo: fd.get('tipo'), canal: fd.get('canal'), detalle: nullable(fd.get('detalle')), fechaCompromiso: nullable(fd.get('fechaCompromiso')) }) });
          await showSuccess('Seguimiento registrado.');
          await renderCollections();
          return true;
        }
      });
    }

    async function openWhatsApp({ idCliente, idFiado = null }) {
      if (!can('recordatorios_fiado')) return showError('Los recordatorios estan disponibles en el plan avanzado.');
      let prepared = null;
      await openFormModal({
        title: 'Preparar mensaje de WhatsApp',
        body: `<div class="form-grid"><label>Tipo de mensaje<select name="tipoPlantilla">${TEMPLATE_TYPES.map((item) => option(item, statusText(item), idFiado ? 'recordatorio_previo' : 'estado_cuenta')).join('')}</select></label><label class="check"><input name="registrarPreparacion" type="checkbox"> Registrar que el recordatorio fue preparado</label></div><div class="whatsapp-preview" data-whatsapp-preview><p class="muted">El backend preparara el texto usando una plantilla activa de esta tienda.</p></div>`,
        submitText: 'Preparar vista previa', wide: true,
        onSubmit: async (form) => {
          const fd = new FormData(form);
          prepared = await api('/api/cobranza/mensaje-whatsapp/preparar', { method: 'POST', body: JSON.stringify({ idCliente, idFiado, tipoPlantilla: fd.get('tipoPlantilla'), registrarPreparacion: booleanValue(form, 'registrarPreparacion') }) });
          const target = form.querySelector('[data-whatsapp-preview]');
          target.innerHTML = `<label>Texto preparado<textarea readonly rows="8">${e(prepared.texto)}</textarea></label><p class="hint">${e(prepared.advertencia || '')}</p><div class="actions"><button type="button" class="secondary" data-copy-whatsapp>Copiar texto</button>${prepared.url ? '<button type="button" data-open-whatsapp>Abrir WhatsApp</button>' : ''}${can('seguimiento_cobranza') && !readOnly() ? '<button type="button" class="secondary" data-mark-manual>Marcar como enviado manualmente</button>' : ''}</div><p class="manual-send-note">Abrir WhatsApp no registra el mensaje como enviado.</p>`;
          target.querySelector('[data-copy-whatsapp]').addEventListener('click', async (event) => {
            await copyText(prepared.texto);
            event.currentTarget.textContent = 'Texto copiado';
          });
          target.querySelector('[data-open-whatsapp]')?.addEventListener('click', () => window.open(prepared.url, '_blank', 'noopener'));
          target.querySelector('[data-mark-manual]')?.addEventListener('click', async () => {
            const button = target.querySelector('[data-mark-manual]');
            if (button.dataset.confirmed !== 'true') {
              button.dataset.confirmed = 'true';
              button.textContent = 'Confirmar envio manual';
              return;
            }
            await api('/api/cobranza/seguimientos', { method: 'POST', body: JSON.stringify({ idCliente, idFiado, tipo: 'mensaje_enviado_manual', canal: 'whatsapp', detalle: 'Envio manual confirmado por el usuario.' }) });
            await showSuccess('Envio manual registrado en seguimiento.');
          });
          form.querySelector('[data-modal-submit]').textContent = 'Actualizar vista previa';
          return false;
        }
      });
    }

    async function openCreditConfiguration() {
      if (!can('limites_credito')) return showError('La configuracion avanzada de credito no esta incluida en este plan.');
      try {
        const config = await api('/api/configuracion-credito');
        await openFormModal({
          title: 'Configuracion de credito', wide: true, body: `<div class="form-grid credit-config-form">
            <label>Limite predeterminado<input name="limiteCreditoDefault" type="number" min="0" step="0.01" value="${e(config.limiteCreditoDefault ?? '')}" placeholder="Sin limite predeterminado"></label>
            <label>Dias de credito<input name="diasCreditoDefault" type="number" min="1" max="365" required value="${e(config.diasCreditoDefault)}"></label>
            <label>Dias de aviso<input name="diasAvisoVencimiento" type="number" min="0" max="90" required value="${e(config.diasAvisoVencimiento)}"></label>
            <label>Politica de deuda vencida<select name="politicaFiadoVencido">${['permitir', 'advertir', 'bloquear'].map((item) => option(item, item, config.politicaFiadoVencido)).join('')}</select></label>
            <label class="check"><input name="requiereTelefonoParaFiado" type="checkbox" ${config.requiereTelefonoParaFiado ? 'checked' : ''}> Exigir telefono para fiar</label>
            <label class="check"><input name="permiteFiadoSinFecha" type="checkbox" ${config.permiteFiadoSinFecha ? 'checked' : ''}> Permitir fiado sin fecha</label>
            <label>Codigo de pais WhatsApp<input name="codigoPaisWhatsApp" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8" value="${e(config.codigoPaisWhatsApp || '')}" placeholder="Ejemplo: 591"></label>
          </div><div class="credit-policy-help"><p><strong>Permitir:</strong> permite nuevas ventas con advertencia.</p><p><strong>Advertir:</strong> solicita confirmacion y motivo.</p><p><strong>Bloquear:</strong> no permite nuevos fiados con deuda vencida.</p><p>El codigo de pais usa solo digitos, sin signo +. No se asigna ningun pais automaticamente.</p></div>`,
          submitText: 'Guardar configuracion',
          onSubmit: async (form) => {
            const fd = new FormData(form);
            const payload = { limiteCreditoDefault: nullable(fd.get('limiteCreditoDefault')), diasCreditoDefault: fd.get('diasCreditoDefault'), diasAvisoVencimiento: fd.get('diasAvisoVencimiento'), politicaFiadoVencido: fd.get('politicaFiadoVencido'), requiereTelefonoParaFiado: booleanValue(form, 'requiereTelefonoParaFiado'), permiteFiadoSinFecha: booleanValue(form, 'permiteFiadoSinFecha'), codigoPaisWhatsApp: nullable(fd.get('codigoPaisWhatsApp')) };
            await api('/api/configuracion-credito', { method: 'PUT', body: JSON.stringify(payload) });
            await showSuccess('Configuracion de credito guardada.');
            return true;
          }
        });
      } catch (error) { showError(error.message); }
    }

    function statementMarkup(data, period = {}) {
      const customer = data.cliente;
      const purchasesTotal = Number(data.resumenPeriodo?.compras?.total ?? data.compras.reduce((sum, row) => sum + Number(row.total || 0), 0));
      const generatedDebt = Number(data.resumenPeriodo?.fiadoGenerado?.total ?? [...data.fiadosAbiertos, ...data.fiadosPagados].reduce((sum, row) => sum + Number(row.totalFiado || 0), 0));
      const paymentsTotal = Number(data.resumenPeriodo?.pagos?.total ?? data.pagos.reduce((sum, row) => sum + Number(row.monto || 0), 0));
      const page = data.paginacion || data;
      return `<section class="account-statement" id="customerAccountStatement">
        <header><div><span class="eyebrow">Estado de cuenta</span><h2>${e(customer.nombre)}</h2><p>${e(state().context?.tienda?.nombre || 'Mi tienda')} · generado ${e(formatDate(new Date()))}</p><p>Periodo: ${e(period.fechaDesde || 'inicio')} a ${e(period.fechaHasta || 'hoy')}</p></div><div><strong>Deuda actual</strong><span>Bs ${money(customer.deudaActual)}</span></div></header>
        <div class="statement-summary"><span>Compras<strong>Bs ${money(purchasesTotal)}</strong></span><span>Fiado generado<strong>Bs ${money(generatedDebt)}</strong></span><span>Pagos<strong>Bs ${money(paymentsTotal)}</strong></span><span>Deuda actual<strong>Bs ${money(customer.deudaActual)}</strong></span><span>Limite<strong>${valueOrUnknown(customer.limiteEfectivo, 'Bs ')}</strong></span><span>Credito disponible<strong>${valueOrUnknown(customer.creditoDisponible, 'Bs ')}</strong></span></div>
        <h3>Movimientos</h3><p class="hint">Mostrando ${data.movimientos.length} de ${Number(page.total || data.movimientos.length)} movimientos, pagina ${Number(page.page || 1)} de ${Number(page.totalPages || 1)}.</p>${listOrEmpty(data.movimientos, (row) => `<article class="statement-row"><div><strong>${e(statusText(row.tipo))}</strong><span>${e(formatDate(row.fecha))}${row.idFiado ? ` · Fiado #${e(row.idFiado)}` : ''}</span></div><strong class="${row.tipo === 'pago' ? 'text-ok' : 'text-danger'}">${row.tipo === 'pago' ? '-' : '+'} Bs ${money(row.monto)}</strong></article>`, 'No hay movimientos en el periodo.')}
        <p class="statement-note">Este documento es un estado de cuenta interno y no reemplaza una factura fiscal.</p>
      </section>`;
    }

    async function openStatement(idCliente, period = {}) {
      try {
        const returnFocus = document.activeElement;
        const statementPage = Number(period.pagina || 1);
        const query = new URLSearchParams({ pagina: statementPage, limite: 100 });
        if (period.fechaDesde) query.set('fechaDesde', period.fechaDesde);
        if (period.fechaHasta) query.set('fechaHasta', period.fechaHasta);
        const data = await api(`/api/clientes/${idCliente}/estado-cuenta?${query}`);
        modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal modal-wide statement-modal" role="dialog" aria-modal="true" aria-label="Estado de cuenta"><form class="statement-filters no-print" data-statement-filters><label>Desde<input name="fechaDesde" type="date" value="${e(period.fechaDesde || '')}"></label><label>Hasta<input name="fechaHasta" type="date" value="${e(period.fechaHasta || '')}"></label><button type="submit" class="secondary">Aplicar periodo</button></form>${statementMarkup(data, period)}<div class="credit-pagination no-print" aria-label="Paginas del estado de cuenta"><button type="button" class="secondary" data-statement-page="${statementPage - 1}" ${data.hasPreviousPage ? '' : 'disabled'}>Anterior</button><span>Pagina ${data.page} de ${data.totalPages}</span><button type="button" class="secondary" data-statement-page="${statementPage + 1}" ${data.hasNextPage ? '' : 'disabled'}>Siguiente</button></div><div class="modal-actions no-print"><button type="button" class="secondary" data-statement-copy>Copiar resumen</button>${can('exportacion_clientes_fiados') ? `<button type="button" class="secondary" data-statement-export ${readOnly() ? 'disabled title="La suscripcion debe estar activa para exportar."' : ''}>Exportar XLSX</button>` : ''}${can('recordatorios_fiado') ? '<button type="button" class="secondary" data-statement-whatsapp>Preparar WhatsApp</button>' : ''}<button type="button" data-statement-print>Imprimir</button><button type="button" class="secondary" data-modal-cancel>Cerrar</button></div></section></div>`;
        modalRoot.querySelector('[data-statement-filters]').addEventListener('submit', (event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          openStatement(idCliente, { fechaDesde: nullable(fd.get('fechaDesde')), fechaHasta: nullable(fd.get('fechaHasta')) });
        });
        modalRoot.querySelectorAll('[data-statement-page]:not([disabled])').forEach((button) => button.addEventListener('click', () => {
          openStatement(idCliente, { ...period, pagina: Number(button.dataset.statementPage) });
        }));
        modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', () => { modalRoot.innerHTML = ''; returnFocus?.focus?.(); });
        modalRoot.querySelector('[data-statement-print]').addEventListener('click', () => window.print());
        modalRoot.querySelector('[data-statement-export]:not([disabled])')?.addEventListener('click', (event) => {
          const query = filterQuery({}, {
            fechaDesde: period.fechaDesde,
            fechaHasta: period.fechaHasta
          });
          downloadWorkbook(
            `/api/clientes/${idCliente}/estado-cuenta/exportacion.xlsx?${query}`,
            event.currentTarget,
            `estado_cuenta_${localDateValue()}.xlsx`
          );
        });
        modalRoot.querySelector('[data-statement-copy]').addEventListener('click', async (event) => {
          await copyText(`Estado de cuenta de ${data.cliente.nombre}\nDeuda actual: Bs ${money(data.cliente.deudaActual)}\nFiados abiertos: ${data.fiadosAbiertos.length}`);
          event.currentTarget.textContent = 'Resumen copiado';
        });
        modalRoot.querySelector('[data-statement-whatsapp]')?.addEventListener('click', () => openWhatsApp({ idCliente }));
      } catch (error) { showError(error.message); }
    }

    async function refreshPosCredit(balance = 0) {
      const target = document.getElementById('posCreditSummary');
      const select = document.getElementById('posClient');
      if (!target || !select) return;
      const idCliente = select.value;
      ui.posBalance = Number(balance || 0);
      if (!idCliente) {
        ui.posCustomerId = null;
        ui.posSnapshot = null;
        target.innerHTML = Number(balance) > 0 ? '<div class="pos-credit-warning">El cliente ocasional solo puede pagar al contado.</div>' : '';
        return;
      }
      if (ui.posCustomerId !== idCliente || !ui.posSnapshot) {
        if (ui.posLoadingCustomerId === idCliente) return;
        ui.posLoadingCustomerId = idCliente;
        const request = ++ui.posRequest;
        target.innerHTML = '<div class="loading-state compact">Consultando credito...</div>';
        try {
          const [data, configuration] = await Promise.all([
            api(`/api/clientes/${idCliente}/resumen`),
            api('/api/configuracion-credito')
          ]);
          if (request !== ui.posRequest) return;
          ui.posCustomerId = idCliente;
          ui.posSnapshot = data.cliente;
          ui.posConfiguration = configuration;
          ui.posLoadingCustomerId = null;
          return refreshPosCredit(ui.posBalance);
        } catch (error) {
          ui.posLoadingCustomerId = null;
          if (request === ui.posRequest) target.innerHTML = `<div class="error-state compact">${e(error.message)}</div>`;
          return;
        }
      }
      const customer = ui.posSnapshot;
      const configuration = ui.posConfiguration || {};
      const hasBalance = Number(balance) > 0;
      const dueDays = Number(customer.diasCreditoDefault || configuration.diasCreditoDefault || 0);
      const suggestedDueDate = dueDays > 0 ? addLocalDays(dueDays) : '';
      const overduePolicy = configuration.politicaFiadoVencido || 'advertir';
      target.innerHTML = `<div class="pos-credit-card"><div class="pos-credit-metrics"><span>Deuda<strong>Bs ${money(customer.deudaActual)}</strong></span><span>Vencida<strong>Bs ${money(customer.deudaVencida)}</strong></span><span>Limite<strong>${valueOrUnknown(customer.limiteEfectivo, 'Bs ')}</strong></span><span>Disponible<strong>${valueOrUnknown(customer.creditoDisponible, 'Bs ')}</strong></span></div>
        <p>${customer.permiteFiado ? 'Cliente habilitado para fiado.' : 'Este cliente no permite nuevos fiados.'}</p>
        ${hasBalance ? `<div class="pos-credit-fields"><label>Fecha de vencimiento<input id="posCreditDueDate" type="date" min="${e(localDateValue())}" value="${e(suggestedDueDate)}"></label><label>Observacion de credito<input id="posCreditObservation" maxlength="1000"></label></div>${Number(customer.deudaVencida) > 0 ? `<div class="overdue-confirmation"><strong>Politica: ${e(overduePolicy)}</strong><p>${overduePolicy === 'bloquear' ? 'No se permiten nuevos fiados con deuda vencida. Puedes cambiar la venta a contado.' : overduePolicy === 'advertir' ? 'Para continuar debes confirmar e indicar un motivo.' : 'La venta puede continuar con una advertencia.'}</p>${overduePolicy === 'advertir' ? '<label class="check"><input id="posConfirmOverdue" type="checkbox"> Confirmo continuar pese a la deuda vencida</label><label>Motivo<textarea id="posOverdueReason" maxlength="2000"></textarea></label>' : ''}</div>` : ''}` : ''}</div>`;
    }

    function posCreditPayload(balance) {
      if (!(Number(balance) > 0)) return {};
      const idCliente = document.getElementById('posClient')?.value;
      if (!idCliente) throw new Error('Selecciona un cliente registrado para dejar saldo pendiente.');
      const customer = ui.posSnapshot;
      const overduePolicy = ui.posConfiguration?.politicaFiadoVencido || 'advertir';
      if (!customer || String(ui.posCustomerId) !== String(idCliente)) throw new Error('Espera a que termine la consulta de credito del cliente.');
      if (!customer.permiteFiado) throw new Error('Este cliente no permite nuevos fiados. Puedes cambiar la venta a contado.');
      if (Number(customer.deudaVencida) > 0 && overduePolicy === 'bloquear') {
        throw new Error('La politica de la tienda bloquea nuevos fiados con deuda vencida. Puedes cambiar la venta a contado.');
      }
      const payload = { fechaVencimiento: nullable(document.getElementById('posCreditDueDate')?.value), observacionCredito: nullable(document.getElementById('posCreditObservation')?.value) };
      if (Number(customer.deudaVencida) > 0 && overduePolicy === 'advertir') {
        payload.confirmarDeudaVencida = Boolean(document.getElementById('posConfirmOverdue')?.checked);
        payload.motivoDeudaVencida = nullable(document.getElementById('posOverdueReason')?.value);
        if (!payload.confirmarDeudaVencida || !payload.motivoDeudaVencida) throw new Error('Para continuar con deuda vencida debes confirmar la decision e indicar un motivo.');
      }
      return payload;
    }

    function resetPosCredit() {
      ui.posCustomerId = null;
      ui.posSnapshot = null;
      ui.posConfiguration = null;
      ui.posLoadingCustomerId = null;
      ui.posBalance = 0;
      ui.posRequest += 1;
    }

    return {
      renderCustomers,
      renderCollections,
      openCustomerProfile,
      openPayment,
      openStatement,
      refreshPosCredit,
      posCreditPayload,
      resetPosCredit
    };
  }

  window.CustomerCreditUI = { create };
}());
