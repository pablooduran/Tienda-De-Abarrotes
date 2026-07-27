(function inventoryAdjustmentModule(global) {
  const STATUS_LABELS = Object.freeze({ ok: 'Correcto', warning: 'Advertencia', error: 'Error' });
  const REASON_LABELS = Object.freeze({
    conteo_fisico: 'Conteo fisico',
    merma: 'Merma',
    danio: 'Mercancia danada',
    vencimiento: 'Vencimiento',
    correccion_registro: 'Correccion de registro',
    otro_controlado: 'Otro motivo controlado'
  });
  const CODE_LABELS = Object.freeze({
    STOCK_NEGATIVE: 'Stock fisico negativo',
    LOT_QUANTITY_NEGATIVE: 'Lote con cantidad negativa',
    LOT_PHYSICAL_MISMATCH: 'El stock fisico no coincide con los lotes',
    STOCK_LEDGER_MISMATCH: 'El stock fisico no coincide con sus movimientos',
    STOCK_MOVEMENT_REFERENCE_INVALID: 'Movimiento con referencia invalida',
    LOT_MOVEMENT_ORPHAN: 'Movimiento de lote sin referencia valida',
    LOT_ASSIGNMENT_DUPLICATED: 'Asignacion de lote duplicada',
    TECHNICAL_LOT_SELLABLE: 'Un lote tecnico aparece como vendible',
    UNSELLABLE_STOCK_PRESENT: 'Existe mercancia no vendible'
  });

  function create(dependencies) {
    const {
      api, root, getProducts, hasFeature, isReadOnly, escapeHtml,
      formatDate, newOperationKey, showSuccess
    } = dependencies;
    const e = escapeHtml;
    const state = {
      page: 1, pageSize: 25, status: 'todos', search: '',
      request: 0, reconciliation: null, history: null, trigger: null
    };

    const loading = () =>
      '<div class="inventory-operation-state" role="status" aria-live="polite">Cargando conciliacion...</div>';

    function errorState(error) {
      return `<div class="inventory-operation-state error" role="alert">
        <strong>No se pudo consultar el inventario.</strong>
        <span>${e(error.message || 'Intente nuevamente.')}</span>
        <button type="button" class="secondary" data-inventory-retry>Reintentar</button>
      </div>`;
    }

    function statusBadge(status) {
      return `<span class="inventory-reconciliation-status ${e(status)}">
        ${e(STATUS_LABELS[status] || status)}
      </span>`;
    }

    function findingList(row) {
      if (!row.conciliacion.hallazgos.length) return '<span>Sin diferencias</span>';
      return `<ul class="inventory-findings">${row.conciliacion.hallazgos.map((item) =>
        `<li><strong>${e(item.severity === 'error' ? 'Error' : 'Advertencia')}:</strong>
          ${e(CODE_LABELS[item.code] || item.code)}</li>`).join('')}</ul>`;
    }

    function reconciliationTable(data) {
      if (!data.resultados.length) {
        return '<div class="inventory-operation-state" role="status">No hay productos para los filtros aplicados.</div>';
      }
      return `<div class="table-scroll"><table class="inventory-reconciliation-table">
        <caption class="sr-only">Conciliacion de stock fisico y vendible</caption>
        <thead><tr><th scope="col">Producto</th><th scope="col">Fisico</th>
          <th scope="col">Vendible</th><th scope="col">No vendible</th>
          <th scope="col">Desglose</th><th scope="col">Conciliacion</th></tr></thead>
        <tbody>${data.resultados.map((row) => `<tr>
          <th scope="row">${e(row.nombre)}${row.controlaLotes ? '<small>Controlado por lotes</small>' : ''}</th>
          <td>${e(row.stockFisico)}</td><td>${e(row.stockVendible)}</td>
          <td>${e(row.stockNoVendible)}</td>
          <td><span>Vencido: ${e(row.desgloseNoVendible.vencido)}</span>
            <span>Bloqueado: ${e(row.desgloseNoVendible.bloqueado)}</span>
            <span>Aislado: ${e(row.desgloseNoVendible.aislado)}</span>
            <span>Tecnico: ${e(row.desgloseNoVendible.tecnico)}</span></td>
          <td>${statusBadge(row.conciliacion.estado)}${findingList(row)}</td>
        </tr>`).join('')}</tbody></table></div>`;
    }

    function historyTable(data) {
      if (!data?.resultados?.length) {
        return '<div class="inventory-operation-state" role="status">Todavia no hay ajustes manuales.</div>';
      }
      return `<div class="table-scroll"><table>
        <caption class="sr-only">Historial de ajustes manuales</caption>
        <thead><tr><th scope="col">Fecha</th><th scope="col">Producto</th>
          <th scope="col">Tipo</th><th scope="col">Cantidad</th>
          <th scope="col">Fisico</th><th scope="col">Vendible</th>
          <th scope="col">Motivo</th><th scope="col">Responsable</th></tr></thead>
        <tbody>${data.resultados.map((row) => `<tr>
          <td>${e(formatDate(row.creadoEn))}</td><th scope="row">${e(row.producto)}</th>
          <td>${e(row.tipoAjuste)}</td><td>${e(row.cantidad)}</td>
          <td>${e(row.stockFisicoAnterior)} a ${e(row.stockFisicoPosterior)}</td>
          <td>${e(row.stockVendibleAnterior)} a ${e(row.stockVendiblePosterior)}</td>
          <td>${e(REASON_LABELS[row.motivoCodigo] || row.motivoCodigo)}</td>
          <td>${e(row.responsable)}</td>
        </tr>`).join('')}</tbody></table></div>`;
    }

    function renderData() {
      const data = state.reconciliation;
      const summary = data.resumen;
      root.querySelector('[data-inventory-content]').innerHTML = `
        <dl class="inventory-stock-metrics">
          ${[['Stock fisico', summary.stockFisico], ['Stock vendible', summary.stockVendible],
            ['Stock no vendible', summary.stockNoVendible], ['Correctos', summary.ok],
            ['Advertencias', summary.warning], ['Errores', summary.error]]
            .map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}
        </dl>
        ${reconciliationTable(data)}
        <div class="inventory-pagination" aria-label="Paginacion de conciliacion">
          <button type="button" class="secondary" data-inventory-previous
            ${data.paginacion.hasPreviousPage ? '' : 'disabled'}>Anterior</button>
          <span>Pagina ${e(data.paginacion.page)} de ${e(data.paginacion.totalPages)}</span>
          <button type="button" class="secondary" data-inventory-next
            ${data.paginacion.hasNextPage ? '' : 'disabled'}>Siguiente</button>
        </div>
        <section class="inventory-adjustment-history" aria-labelledby="inventoryHistoryTitle">
          <h3 id="inventoryHistoryTitle">Historial de ajustes</h3>${historyTable(state.history)}
        </section>`;
      root.querySelector('[data-inventory-previous]')?.addEventListener('click', () => {
        state.page -= 1;
        load();
      });
      root.querySelector('[data-inventory-next]')?.addEventListener('click', () => {
        state.page += 1;
        load();
      });
    }

    async function load() {
      const request = ++state.request;
      const target = root.querySelector('[data-inventory-content]');
      target.innerHTML = loading();
      const query = new URLSearchParams({
        page: String(state.page), pageSize: String(state.pageSize), estado: state.status
      });
      if (state.search) query.set('busqueda', state.search);
      try {
        const [reconciliation, history] = await Promise.all([
          api(`/api/inventario/conciliacion?${query}`),
          hasFeature('historial_stock')
            ? api('/api/inventario/ajustes?page=1&pageSize=25')
            : Promise.resolve({ resultados: [], paginacion: {} })
        ]);
        if (request !== state.request) return;
        state.reconciliation = reconciliation;
        state.history = history;
        renderData();
      } catch (error) {
        if (request !== state.request) return;
        target.innerHTML = errorState(error);
        target.querySelector('[data-inventory-retry]')?.addEventListener('click', load);
      }
    }

    function dialogMarkup() {
      const products = getProducts().filter((product) => Number(product.activo) === 1);
      return `<form method="dialog" class="inventory-adjustment-form" data-adjustment-form>
        <h2 id="inventoryAdjustmentTitle">Registrar ajuste manual</h2>
        <p>El movimiento original se conserva y el ajuste queda en el historial.</p>
        <label>Producto<select name="idProducto" required><option value="">Seleccione</option>
          ${products.map((product) => `<option value="${e(product.idProducto)}"
            data-lots="${Number(product.controlaLotes) === 1 ? '1' : '0'}"
            data-expiration="${Number(product.controlaVencimiento) === 1 ? '1' : '0'}">
            ${e(product.nombre)}</option>`).join('')}
        </select></label>
        <div class="inventory-adjustment-grid">
          <label>Tipo<select name="tipoAjuste" required>
            <option value="positivo">Ajuste positivo</option>
            <option value="negativo">Ajuste negativo</option></select></label>
          <label>Cantidad<input name="cantidad" type="number" min="1" step="1" required></label>
          <label>Motivo<select name="motivoCodigo" required>
            ${Object.entries(REASON_LABELS).map(([value, label]) =>
              `<option value="${e(value)}">${e(label)}</option>`).join('')}</select></label>
          <label>Clasificacion<select name="clasificacionInventario">
            <option value="vendible">Vendible</option><option value="bloqueado">Bloqueado</option>
            <option value="aislado">Aislado</option></select></label>
        </div>
        <fieldset data-lot-fields hidden><legend>Trazabilidad por lote</legend>
          <label>Modo<select name="modoLotes">
            <option value="lote_nuevo">Crear lote controlado</option>
            <option value="fefo_fifo">Consumir por FEFO/FIFO</option>
            <option value="lote_explicito">Consumir lote explicito</option></select></label>
          <label data-expiration-field>Vencimiento<input name="fechaVencimiento" type="date"></label>
          <label>Costo unitario<input name="costoUnitarioBase" type="number" min="0" step="0.000001"></label>
          <label>Codigo de lote<input name="codigoLote" maxlength="80"></label>
          <label data-explicit-lot-field hidden>Lote<select name="idLoteProducto"></select></label>
        </fieldset>
        <label>Observacion<textarea name="observacion" maxlength="500"></textarea></label>
        <label class="check"><input name="confirmado" type="checkbox" required>
          Confirmo que revise el stock fisico, el tratamiento y el resultado esperado.</label>
        <div class="inventory-adjustment-preview" data-adjustment-preview role="status" aria-live="polite">
          Complete los datos para revisar el ajuste.</div>
        <div class="inventory-dialog-error" data-adjustment-error role="alert"></div>
        <div class="modal-actions"><button type="button" class="secondary" data-adjustment-cancel>Cancelar</button>
          <button type="submit" data-adjustment-submit>Aplicar ajuste</button></div>
      </form>`;
    }

    function openAdjustment(trigger, selectedProductId = null) {
      state.trigger = trigger;
      const dialog = document.createElement('dialog');
      dialog.className = 'inventory-adjustment-dialog';
      dialog.setAttribute('aria-labelledby', 'inventoryAdjustmentTitle');
      dialog.innerHTML = dialogMarkup();
      document.body.appendChild(dialog);
      const form = dialog.querySelector('[data-adjustment-form]');
      const productSelect = form.elements.idProducto;
      const lotFields = form.querySelector('[data-lot-fields]');
      const explicitField = form.querySelector('[data-explicit-lot-field]');
      const errorTarget = form.querySelector('[data-adjustment-error]');
      const submit = form.querySelector('[data-adjustment-submit]');
      const operationKey = newOperationKey();
      if (selectedProductId !== null) productSelect.value = String(selectedProductId);

      async function updateLotFields() {
        const option = productSelect.selectedOptions[0];
        const controlsLots = option?.dataset.lots === '1';
        const positive = form.elements.tipoAjuste.value === 'positivo';
        lotFields.hidden = !controlsLots;
        form.elements.clasificacionInventario.disabled = !controlsLots || !positive;
        if (!controlsLots) return;
        form.elements.modoLotes.value = positive ? 'lote_nuevo' : 'fefo_fifo';
        explicitField.hidden = true;
        form.querySelector('[data-expiration-field]').hidden = option.dataset.expiration !== '1' || !positive;
      }

      function updateReasonRequirement() {
        form.elements.observacion.required = form.elements.motivoCodigo.value === 'otro_controlado';
      }

      async function updateExplicitLots() {
        explicitField.hidden = form.elements.modoLotes.value !== 'lote_explicito';
        if (explicitField.hidden || !productSelect.value) return;
        const data = await api(`/api/productos/${encodeURIComponent(productSelect.value)}/lotes-disponibles`);
        form.elements.idLoteProducto.innerHTML = data.lotes
          .filter((lot) => Number(lot.cantidadRestante) > 0 && lot.estadoOperativo !== 'anulado')
          .map((lot) => `<option value="${e(lot.idLoteProducto)}">${e(lot.codigoLote || `Lote ${lot.idLoteProducto}`)}
            (${e(lot.cantidadRestante)}, ${e(lot.clasificacionInventario || lot.motivoNoVendible || 'vendible')})</option>`)
          .join('');
      }

      function preview() {
        const product = productSelect.selectedOptions[0]?.textContent?.trim() || 'sin seleccionar';
        const direction = form.elements.tipoAjuste.value === 'positivo' ? 'aumentara' : 'reducira';
        form.querySelector('[data-adjustment-preview]').textContent =
          `${product}: el stock fisico ${direction} en ${form.elements.cantidad.value || 0} unidades. `
          + `Tratamiento: ${form.elements.clasificacionInventario.value || 'vendible'}.`;
      }

      form.addEventListener('input', preview);
      productSelect.addEventListener('change', async () => {
        await updateLotFields();
        await updateExplicitLots();
        preview();
      });
      form.elements.tipoAjuste.addEventListener('change', async () => {
        await updateLotFields();
        await updateExplicitLots();
        preview();
      });
      form.elements.modoLotes.addEventListener('change', () => {
        updateExplicitLots().catch((error) => { errorTarget.textContent = error.message; });
      });
      form.elements.motivoCodigo.addEventListener('change', updateReasonRequirement);
      form.querySelector('[data-adjustment-cancel]').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => {
        dialog.remove();
        state.trigger?.focus?.();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorTarget.textContent = '';
        updateReasonRequirement();
        if (!form.reportValidity()) return;
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        const option = productSelect.selectedOptions[0];
        const controlsLots = option?.dataset.lots === '1';
        const positive = form.elements.tipoAjuste.value === 'positivo';
        const payload = {
          idProducto: Number(form.elements.idProducto.value),
          tipoAjuste: form.elements.tipoAjuste.value,
          cantidad: Number(form.elements.cantidad.value),
          motivoCodigo: form.elements.motivoCodigo.value,
          observacion: form.elements.observacion.value,
          confirmado: form.elements.confirmado.checked,
          claveOperacion: operationKey,
          modoLotes: controlsLots ? form.elements.modoLotes.value : 'no_aplica',
          clasificacionInventario: controlsLots && positive
            ? form.elements.clasificacionInventario.value : 'vendible',
          idLoteProducto: controlsLots && !positive && form.elements.modoLotes.value === 'lote_explicito'
            ? Number(form.elements.idLoteProducto.value) : null,
          lote: controlsLots && positive ? {
            codigoLote: form.elements.codigoLote.value,
            fechaVencimiento: form.elements.fechaVencimiento.value || null,
            costoUnitarioBase: form.elements.costoUnitarioBase.value || null
          } : null
        };
        try {
          const response = await api('/api/inventario/ajustes', {
            method: 'POST', body: JSON.stringify(payload)
          });
          dialog.close();
          await showSuccess(response.message);
          state.page = 1;
          await load();
        } catch (error) {
          errorTarget.textContent = error.code === 'OPERATION_KEY_CONFLICT'
            ? 'La operacion ya se uso con datos diferentes. Revise los datos.'
            : error.message;
        } finally {
          submit.disabled = false;
          submit.removeAttribute('aria-busy');
        }
      });
      dialog.showModal();
      updateReasonRequirement();
      updateLotFields().catch((error) => { errorTarget.textContent = error.message; });
      preview();
      productSelect.focus();
    }

    async function render() {
      root.innerHTML = `<section class="inventory-operations" aria-labelledby="inventoryOperationsTitle">
        <div class="inventory-operations-heading"><div>
          <h2 id="inventoryOperationsTitle">Stock vendible y conciliacion</h2>
          <p>El stock fisico incluye mercancia no disponible. El vendible excluye vencidos, bloqueados, aislados y tecnicos.</p>
        </div>${hasFeature('ajuste_stock') && !isReadOnly()
          ? '<button type="button" data-new-inventory-adjustment>Registrar ajuste</button>'
          : '<span class="muted">Ajustes no disponibles en modo de solo lectura.</span>'}</div>
        <form class="inventory-reconciliation-filters" data-inventory-filters>
          <label>Buscar<input name="busqueda" maxlength="100"></label>
          <label>Estado<select name="estado"><option value="todos">Todos</option>
            <option value="ok">Correctos</option><option value="warning">Advertencias</option>
            <option value="error">Errores</option></select></label>
          <button type="submit" class="secondary">Aplicar filtros</button>
        </form><div data-inventory-content>${loading()}</div>
      </section>`;
      root.querySelector('[data-new-inventory-adjustment]')?.addEventListener(
        'click', (event) => openAdjustment(event.currentTarget)
      );
      root.querySelector('[data-inventory-filters]').addEventListener('submit', (event) => {
        event.preventDefault();
        state.search = event.currentTarget.elements.busqueda.value.trim();
        state.status = event.currentTarget.elements.estado.value;
        state.page = 1;
        load();
      });
      await load();
    }

    return Object.freeze({
      render,
      openAdjustment: (idProducto, trigger) => openAdjustment(trigger, idProducto)
    });
  }

  global.InventoryAdjustmentUI = Object.freeze({ create });
}(window));
