(function compensationModule(global) {
  'use strict';

  const REASONS = [
    ['error_cantidad', 'Cantidad incorrecta'],
    ['error_producto', 'Producto incorrecto'],
    ['error_cliente', 'Cliente asociado incorrecto'],
    ['error_metodo_pago', 'Metodo de pago incorrecto'],
    ['operacion_duplicada', 'Operacion duplicada'],
    ['devolucion_cliente', 'Devolucion solicitada por cliente'],
    ['mercaderia_danada', 'Mercaderia danada'],
    ['otro_controlado', 'Otro motivo controlado']
  ];
  const TREATMENTS = [
    ['reintegrar_vendible', 'Reintegrar como mercaderia vendible'],
    ['no_reintegrar', 'No reintegrar al inventario'],
    ['aislar_no_vendible', 'Aislar como mercaderia no vendible']
  ];
  const METHODS = ['efectivo', 'qr', 'transferencia', 'tarjeta', 'otro', 'no_especificado'];
  const SALE_METHODS = ['efectivo', 'qr', 'no_especificado'];

  function create(deps) {
    const {
      api, view, modalRoot, getState, hasFeature, escapeHtml: e, money, formatDate,
      showError, showSuccess, showMessage, newOperationKey, secureFetch, errorFromResponse
    } = deps;
    const ui = {
      tab: 'historial',
      page: 1,
      request: 0,
      filters: {},
      options: null,
      sale: null,
      returnFocus: null
    };

    const label = (value) => String(value || '')
      .replace(/_/g, ' ')
      .replace(/^./, (char) => char.toUpperCase());
    const option = (value, text, selected = '') =>
      `<option value="${e(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${e(text)}</option>`;
    const badge = (value) =>
      `<span class="compensation-status status-${e(value || 'unknown')}">${e(label(value || 'sin estado'))}</span>`;
    const readOnly = () => Boolean(getState().context?.soloLectura);

    function closeModal(returnFocus = ui.returnFocus) {
      modalRoot.innerHTML = '';
      returnFocus?.focus?.();
      ui.returnFocus = null;
    }

    function openDialog(title, content, trigger) {
      const returnFocus = trigger || document.activeElement;
      ui.returnFocus = returnFocus;
      modalRoot.innerHTML = `<div class="modal-backdrop">
        <section class="modal modal-wide compensation-modal" role="dialog" aria-modal="true"
          aria-labelledby="compensationDialogTitle">
          <h3 id="compensationDialogTitle">${e(title)}</h3>
          <div class="modal-body">${content}</div>
        </section>
      </div>`;
      modalRoot.querySelector('[data-modal-cancel]')?.addEventListener('click', () => closeModal(returnFocus));
      modalRoot.querySelector('input,select,textarea,button')?.focus();
      return returnFocus;
    }

    function commonFields() {
      return `<fieldset><legend>Justificacion</legend>
        <label>Motivo
          <select name="motivoCodigo" required>
            <option value="">Seleccione un motivo</option>
            ${REASONS.map(([value, text]) => option(value, text)).join('')}
          </select>
        </label>
        <label>Observacion
          <textarea name="observacion" maxlength="1000"
            aria-describedby="compensationObservationHelp"></textarea>
        </label>
        <small id="compensationObservationHelp">Obligatoria, con al menos 8 caracteres, cuando se elige otro motivo controlado.</small>
      </fieldset>
      <label class="confirmation-check">
        <input name="confirmar" type="checkbox" required>
        Confirmo que revise el resumen y que el registro original permanecera en el historial.
      </label>
      <p class="form-error" role="alert" aria-live="assertive" data-form-error></p>
      <div class="modal-actions">
        <button type="button" class="secondary" data-modal-cancel>Cancelar</button>
        <button type="submit" class="danger" data-compensation-submit>Confirmar compensacion</button>
      </div>`;
    }

    function commonPayload(form, operationKey) {
      const reason = form.elements.motivoCodigo.value;
      const observation = form.elements.observacion.value.trim();
      if (reason === 'otro_controlado' && observation.length < 8) {
        throw new Error('El otro motivo controlado requiere una observacion de al menos 8 caracteres.');
      }
      if (!form.elements.confirmar.checked) {
        throw new Error('Debes confirmar expresamente la operacion.');
      }
      return {
        confirmar: true,
        claveOperacion: operationKey,
        motivoCodigo: reason,
        observacion: observation || null
      };
    }

    function wireActionForm(form, operation) {
      const button = form.querySelector('[data-compensation-submit]');
      const errorBox = form.querySelector('[data-form-error]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (button.disabled) return;
        errorBox.textContent = '';
        button.disabled = true;
        const previous = button.textContent;
        button.textContent = 'Procesando...';
        try {
          const result = await operation(form);
          closeModal();
          await showSuccess(result.message || (result.repetida
            ? 'La operacion ya habia sido aplicada; no se duplico.'
            : 'Operacion compensatoria aplicada.'));
          await render();
        } catch (error) {
          errorBox.textContent = error.code === 'OPERATION_KEY_CONFLICT'
            ? 'La solicitud ya no coincide con el intento original. Cierra este formulario e inicia una operacion nueva.'
            : error.message;
          button.disabled = false;
          button.textContent = previous;
        }
      });
      form.elements.motivoCodigo?.addEventListener('change', () => {
        form.elements.observacion.required = form.elements.motivoCodigo.value === 'otro_controlado';
      });
    }

    function saleSummary(context) {
      const sale = context.venta;
      return `<section class="compensation-preview" aria-label="Resumen de la operacion original">
        <h4>Resumen previo</h4>
        <dl>
          <div><dt>Venta</dt><dd>${e(sale.codigoComprobante || `#${sale.idVenta}`)}</dd></div>
          <div><dt>Cliente</dt><dd>${e(sale.cliente)}</dd></div>
          <div><dt>Total original</dt><dd>Bs ${money(sale.total)}</dd></div>
          <div><dt>Compensado</dt><dd>Bs ${money(sale.montoCompensado)}</dd></div>
          <div><dt>Deuda actual</dt><dd>Bs ${money(sale.saldoPendiente)}</dd></div>
          <div><dt>Estado</dt><dd>${badge(sale.estadoOperacion)}</dd></div>
        </dl>
        <p>El registro original, sus pagos y su fiado se conservan. La liquidacion financiera se resolvera mediante movimientos compensatorios.</p>
      </section>`;
    }

    function openSaleCompensation(type, trigger) {
      const context = ui.sale;
      if (!context || readOnly()) return;
      const isPartial = type === 'devolucion_parcial';
      const key = `comp-ui-sale:${newOperationKey()}`;
      const details = isPartial ? `<fieldset><legend>Productos a devolver</legend>
        <div class="compensation-detail-editor">
          ${context.detalles.map((row) => {
            const available = Number(row.unidadesVendidas) - Number(row.unidadesDevueltas);
            return `<div class="compensation-detail-row">
              <label class="confirmation-check">
                <input type="checkbox" data-return-detail value="${e(row.idDetalleVenta)}" ${available <= 0 ? 'disabled' : ''}>
                <span><strong>${e(row.producto)}</strong><small>Disponible para devolver: ${e(available)}</small></span>
              </label>
              <label>Unidades
                <input type="number" min="1" max="${e(available)}" value="1"
                  data-return-quantity="${e(row.idDetalleVenta)}" ${available <= 0 ? 'disabled' : ''}>
              </label>
              <label>Inventario
                <select data-return-treatment="${e(row.idDetalleVenta)}" ${available <= 0 ? 'disabled' : ''}>
                  ${TREATMENTS.map(([value, text]) => option(value, text)).join('')}
                </select>
              </label>
            </div>`;
          }).join('')}
        </div>
      </fieldset>` : `<fieldset><legend>Tratamiento de inventario</legend>
        <label>Destino de la mercaderia
          <select name="tratamientoInventario" required>
            ${TREATMENTS.map(([value, text]) => option(value, text)).join('')}
          </select>
        </label>
      </fieldset>`;
      openDialog(isPartial ? 'Registrar devolucion parcial' : 'Anular venta', `
        <form data-compensation-form>
          ${saleSummary(context)}
          ${details}
          <section class="compensation-expected" aria-live="polite" data-compensation-expected></section>
          ${commonFields()}
        </form>`, trigger);
      const form = modalRoot.querySelector('[data-compensation-form]');
      const updateExpected = () => {
        let amountCents = Math.max(0, Math.round(
          (Number(context.venta.total) - Number(context.venta.montoCompensado)) * 100
        ));
        let inventory = form.elements.tratamientoInventario?.value || '';
        if (isPartial) {
          amountCents = 0;
          const treatments = new Set();
          for (const checkbox of form.querySelectorAll('[data-return-detail]:checked')) {
            const row = context.detalles.find((item) => String(item.idDetalleVenta) === checkbox.value);
            const quantity = Number(form.querySelector(`[data-return-quantity="${checkbox.value}"]`).value || 0);
            const total = Math.round(Number(row.montoNetoLinea) * 100);
            const sold = Number(row.unidadesVendidas);
            const previous = Number(row.unidadesDevueltas);
            amountCents += Math.floor(total * Math.min(sold, previous + quantity) / sold)
              - Math.floor(total * previous / sold);
            treatments.add(form.querySelector(`[data-return-treatment="${checkbox.value}"]`).value);
          }
          inventory = [...treatments].map(label).join(', ') || 'Sin productos seleccionados';
        }
        const debtCents = Math.min(
          amountCents,
          Math.max(0, Math.round(Number(context.venta.saldoPendiente) * 100))
        );
        const refundCents = amountCents - debtCents;
        form.querySelector('[data-compensation-expected]').innerHTML = `
          <h4>Resultado esperado</h4>
          <dl><div><dt>Compensacion comercial</dt><dd>Bs ${money(amountCents / 100)}</dd></div>
          <div><dt>Reduccion maxima de deuda</dt><dd>Bs ${money(debtCents / 100)}</dd></div>
          <div><dt>Reembolso pendiente estimado</dt><dd>Bs ${money(refundCents / 100)}</dd></div>
          <div><dt>Inventario</dt><dd>${e(inventory ? label(inventory) : 'Sin seleccion')}</dd></div></dl>
          <small>El backend vuelve a calcular y valida estos importes dentro de la transaccion.</small>`;
      };
      form.querySelectorAll('[data-return-detail],[data-return-quantity],[data-return-treatment],select[name="tratamientoInventario"]')
        .forEach((control) => control.addEventListener('change', updateExpected));
      updateExpected();
      wireActionForm(form, async () => {
        const payload = {
          ...commonPayload(form, key),
          tipoCompensacion: type
        };
        if (isPartial) {
          payload.detalles = [...form.querySelectorAll('[data-return-detail]:checked')].map((checkbox) => ({
            idDetalleVenta: Number(checkbox.value),
            unidadesDevueltas: Number(form.querySelector(`[data-return-quantity="${checkbox.value}"]`).value),
            tratamientoInventario: form.querySelector(`[data-return-treatment="${checkbox.value}"]`).value
          }));
          if (!payload.detalles.length) throw new Error('Selecciona al menos un producto para devolver.');
        } else {
          payload.tratamientoInventario = form.elements.tratamientoInventario.value;
        }
        return api(`/api/ventas/${context.venta.idVenta}/compensaciones`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      });
    }

    function openSettlement(item, kind, trigger) {
      const material = kind === 'material';
      const key = `comp-ui-${kind}:${newOperationKey()}`;
      const endpoint = material
        ? `/api/obligaciones-reembolso/${item.idObligacionReembolsoVenta}/liquidaciones`
        : `/api/liquidaciones-compensacion/${item.idLiquidacionCompensacionVenta}/resolver`;
      const financialFields = material ? `<fieldset><legend>Salida material</legend>
        <label>Tipo
          <select name="tipoLiquidacion" required>
            ${option('reembolso_realizado', 'Reembolso realizado')}
            ${option('compensacion_otro_medio', 'Compensacion por otro medio autorizado')}
          </select>
        </label>
        <label>Metodo
          <select name="metodoLiquidacion" required>
            ${METHODS.map((method) => option(method, label(method))).join('')}
          </select>
        </label>
        <label>Monto
          <input name="monto" type="number" min="0.01" step="0.01"
            max="${e(item.montoPendiente)}" value="${e(item.montoPendiente)}" required>
        </label>
        <label>Referencia
          <input name="referencia" maxlength="160" autocomplete="off">
        </label>
        <p class="credit-plan-note">El credito a favor no esta disponible. Esta accion registra el movimiento, no ejecuta una transferencia bancaria.</p>
      </fieldset>` : '';
      openDialog(material ? 'Registrar liquidacion material' : 'Resolver efecto financiero', `
        <form data-compensation-form>
          <section class="compensation-preview">
            <h4>Resumen previo</h4>
            <p><strong>${e(item.codigoComprobante || `Venta #${item.idVenta}`)}</strong> · ${e(item.cliente)}</p>
            <p>${material ? `Pendiente: Bs ${money(item.montoPendiente)}` :
              `Reduccion de deuda: Bs ${money(item.montoReduccionDeudaPendiente)} · Reembolso pendiente: Bs ${money(item.montoReembolsoPendiente)}`}</p>
          </section>
          ${financialFields}
          ${commonFields()}
        </form>`, trigger);
      const form = modalRoot.querySelector('[data-compensation-form]');
      wireActionForm(form, () => {
        const payload = commonPayload(form, key);
        if (material) {
          payload.tipoLiquidacion = form.elements.tipoLiquidacion.value;
          payload.metodoLiquidacion = form.elements.metodoLiquidacion.value;
          payload.monto = form.elements.monto.value;
          payload.referencia = form.elements.referencia.value.trim() || null;
        }
        return api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      });
    }

    function openCollectionCompensation(item, trigger) {
      const key = `comp-ui-collection:${newOperationKey()}`;
      openDialog('Compensar cobro de fiado', `<form data-compensation-form>
        <section class="compensation-preview"><h4>Resumen previo</h4>
          <p>Cobro #${e(item.idCobroFiado)} · Bs ${money(item.montoTotal)} · ${e(label(item.metodoPago))}</p>
          <p>La anulacion revierte exactamente sus distribuciones. La correccion de metodo conserva el importe neto.</p>
        </section>
        <fieldset><legend>Tratamiento financiero</legend>
          <label>Accion<select name="tipoCompensacion">
            ${option('anulacion_total', 'Anular cobro')}
            ${option('correccion_metodo', 'Corregir metodo de pago')}
          </select></label>
          <label>Metodo correcto<select name="metodoDestino">
            ${METHODS.map((method) => option(method, label(method))).join('')}
          </select></label>
          <label>Monto recibido<input name="montoRecibidoDestino" type="number" step="0.01" min="0"></label>
          <label>Referencia<input name="referenciaDestino" maxlength="160"></label>
        </fieldset>
        ${commonFields()}
      </form>`, trigger);
      const form = modalRoot.querySelector('[data-compensation-form]');
      const update = () => {
        const correcting = form.elements.tipoCompensacion.value === 'correccion_metodo';
        form.elements.metodoDestino.disabled = !correcting;
        form.elements.montoRecibidoDestino.disabled = !correcting;
        form.elements.referenciaDestino.disabled = !correcting;
      };
      form.elements.tipoCompensacion.addEventListener('change', update);
      update();
      wireActionForm(form, () => {
        const payload = {
          ...commonPayload(form, key),
          tipoCompensacion: form.elements.tipoCompensacion.value
        };
        if (payload.tipoCompensacion === 'correccion_metodo') {
          payload.metodoDestino = form.elements.metodoDestino.value;
          payload.montoRecibidoDestino = form.elements.montoRecibidoDestino.value || null;
          payload.referenciaDestino = form.elements.referenciaDestino.value.trim() || null;
        }
        return api(`/api/cobros-fiado/${item.idCobroFiado}/compensaciones`, {
          method: 'POST', body: JSON.stringify(payload)
        });
      });
    }

    function openPaymentCorrection(item, trigger) {
      const key = `comp-ui-payment:${newOperationKey()}`;
      openDialog('Corregir metodo de pago', `<form data-compensation-form>
        <section class="compensation-preview"><h4>Resumen previo</h4>
          <p>Pago #${e(item.idPagoVenta)} · Bs ${money(item.monto)} · ${e(label(item.metodoPago))}</p>
          <p>El pago original no se edita y el importe total neto permanece igual.</p>
        </section>
        <fieldset><legend>Metodo correcto</legend>
          <label>Metodo<select name="metodoDestino">
            ${SALE_METHODS.map((method) => option(method, label(method))).join('')}
          </select></label>
          <label>Monto recibido<input name="montoRecibidoDestino" type="number" min="0" step="0.01"></label>
          <label>Referencia<input name="referenciaDestino" maxlength="120"></label>
        </fieldset>
        ${commonFields()}
      </form>`, trigger);
      const form = modalRoot.querySelector('[data-compensation-form]');
      wireActionForm(form, () => api(`/api/pagos-venta/${item.idPagoVenta}/compensaciones/metodo`, {
        method: 'POST',
        body: JSON.stringify({
          ...commonPayload(form, key),
          metodoDestino: form.elements.metodoDestino.value,
          montoRecibidoDestino: form.elements.montoRecibidoDestino.value || null,
          referenciaDestino: form.elements.referenciaDestino.value.trim() || null
        })
      }));
    }

    function receiptMarkup(data) {
      const receipt = data.comprobante || {};
      const financial = receipt.tratamientoFinanciero || {};
      const details = data.detalles || data.distribuciones || [];
      return `<article class="compensation-receipt" data-print-compensation>
        <header><div><span class="eyebrow">Comprobante de compensacion</span>
          <h2>${e(data.tienda?.nombre || 'Tienda')}</h2>
          <p>Registro compensatorio · ${e(formatDate(receipt.fecha))}</p></div>
          <div><span>Numero</span><strong>${e(receipt.numero || 'No disponible')}</strong></div>
        </header>
        <dl class="receipt-details">
          <div><dt>Tipo</dt><dd>${e(label(receipt.tipo))}</dd></div>
          <div><dt>Operacion original</dt><dd>${e(receipt.operacionOriginal || 'No disponible')}</dd></div>
          ${data.cliente?.nombre ? `<div><dt>Cliente</dt><dd>${e(data.cliente.nombre)}</dd></div>` : ''}
          <div><dt>Monto</dt><dd>Bs ${money(receipt.monto)}</dd></div>
          <div><dt>Estado</dt><dd>${badge(receipt.estado || receipt.estadoVenta || receipt.estadoObligacion || 'aplicada')}</dd></div>
          <div><dt>Motivo</dt><dd>${e(label(receipt.motivo))}</dd></div>
          <div><dt>Responsable</dt><dd>${e(data.responsable || 'No disponible')}</dd></div>
          ${receipt.metodo ? `<div><dt>Metodo</dt><dd>${e(label(receipt.metodo))}</dd></div>` : ''}
          ${receipt.metodoOriginal ? `<div><dt>Metodo original</dt><dd>${e(label(receipt.metodoOriginal))}</dd></div>` : ''}
          ${receipt.metodoDestino ? `<div><dt>Metodo correcto</dt><dd>${e(label(receipt.metodoDestino))}</dd></div>` : ''}
          ${receipt.referencia ? `<div><dt>Referencia</dt><dd>${e(receipt.referencia)}</dd></div>` : ''}
        </dl>
        ${details.length ? `<h3>Detalle</h3><div class="receipt-lines">${details.map((row) => `<div>
          <span><strong>${e(row.producto || `Fiado #${row.idFiado || ''}`)}</strong>
          <small>${e(label(row.tratamientoInventario || row.metodoOriginal || ''))}${row.resultadoInventario ? ` · ${e(label(row.resultadoInventario))}` : ''}</small></span>
          <span>${row.unidadesDevueltas ? `${e(row.unidadesDevueltas)} unidades` : ''} ${row.montoCompensado ? `Bs ${money(row.montoCompensado)}` : ''}</span>
        </div>`).join('')}</div>` : ''}
        ${Object.keys(financial).length ? `<section class="receipt-observation"><strong>Tratamiento financiero</strong>
          <p>Deuda: Bs ${money(financial.reduccionDeuda)} · Reembolso pendiente: Bs ${money(financial.reembolsoPendiente)}</p>
        </section>` : ''}
        ${receipt.observacion ? `<section class="receipt-observation"><strong>Observacion</strong><p>${e(receipt.observacion)}</p></section>` : ''}
        <p class="statement-note">Este documento registra una compensacion operativa. No es una factura fiscal.</p>
      </article>`;
    }

    async function openReceipt(kind, id, trigger) {
      const data = await api(`/api/compensaciones/${kind === 'venta' ? 'ventas'
        : kind === 'cobro' ? 'cobros' : kind === 'pago' ? 'pagos' : 'liquidaciones'}/${id}/comprobante`);
      openDialog('Comprobante de compensacion', `${receiptMarkup(data)}
        <div class="modal-actions no-print">
          <button type="button" data-compensation-print>Imprimir</button>
          <button type="button" class="secondary" data-modal-cancel>Cerrar</button>
        </div>`, trigger);
      modalRoot.querySelector('[data-compensation-print]').addEventListener('click', () => {
        document.body.classList.add('printing-compensation');
        global.addEventListener('afterprint', () => document.body.classList.remove('printing-compensation'), { once: true });
        global.print();
      });
    }

    async function download(type, format, button) {
      if (!button || button.disabled) return;
      button.disabled = true;
      const previous = button.textContent;
      button.textContent = 'Generando...';
      try {
        const params = new URLSearchParams(ui.filters);
        const response = await secureFetch(`/api/compensaciones/exportaciones/${type}.${format}?${params}`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw errorFromResponse(response, body, 'No se pudo generar la exportacion.');
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `${type}.${format}`;
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showMessage('Exportacion descargada.');
      } catch (error) {
        await showError(error.message);
      } finally {
        button.disabled = false;
        button.textContent = previous;
      }
    }

    function historyMarkup(data) {
      const rows = data.resultados || [];
      return `<div class="cards compensation-summary">
        <div class="card"><span>Operaciones</span><strong>${e(data.resumen.total)}</strong></div>
        <div class="card"><span>Compensacion comercial</span><strong>Bs ${money(data.resumen.compensacionComercial)}</strong></div>
        <div class="card"><span>Liquidaciones materiales</span><strong>Bs ${money(data.resumen.liquidacionesMateriales)}</strong></div>
        <div class="card"><span>Pendientes</span><strong>${e(data.resumen.pendientes)}</strong></div>
      </div>
      ${rows.length ? `<div class="table-wrap compensation-table"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Venta / cliente</th><th>Responsable</th><th>Estado</th><th>Importe</th><th>Acciones</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td>${e(formatDate(row.fechaSolicitud))}</td>
          <td>${e(label(row.tipoOperacion))}</td>
          <td><strong>${e(row.codigoVenta || (row.idVenta ? `Venta #${row.idVenta}` : 'Operacion financiera'))}</strong><small>${e(row.cliente)}</small></td>
          <td>${e(row.administrador)}</td><td>${badge(row.estado)}</td>
          <td>Bs ${money(row.montoCompensado || row.montoLiquidado)}</td>
          <td><div class="actions"><button type="button" class="small secondary" data-operation-detail="${e(row.idOperacionCompensatoria)}">Ver detalle</button>
          ${row.tipoComprobante ? `<button type="button" class="small" data-compensation-receipt="${e(row.tipoComprobante)}:${e(row.idComprobante)}">Comprobante</button>` : ''}</div></td>
        </tr>`).join('')}</tbody></table></div>
        <div class="compensation-mobile-list">${rows.map((row) => `<article class="compensation-card">
          <header><strong>${e(label(row.tipoOperacion))}</strong>${badge(row.estado)}</header>
          <p>${e(row.codigoVenta || 'Operacion financiera')} · ${e(row.cliente)}</p>
          <small>${e(formatDate(row.fechaSolicitud))} · ${e(row.administrador)}</small>
          <div class="actions"><button type="button" class="small secondary" data-operation-detail="${e(row.idOperacionCompensatoria)}">Ver detalle</button>
          ${row.tipoComprobante ? `<button type="button" class="small" data-compensation-receipt="${e(row.tipoComprobante)}:${e(row.idComprobante)}">Comprobante</button>` : ''}</div>
        </article>`).join('')}</div>`
        : '<div class="empty-state" role="status">No hay operaciones para los filtros seleccionados.</div>'}
      <div class="credit-pagination" aria-label="Paginas del historial">
        <button type="button" class="secondary" data-history-page="${data.paginacion.page - 1}" ${data.paginacion.hasPreviousPage ? '' : 'disabled'}>Anterior</button>
        <span>Pagina ${e(data.paginacion.page)} de ${e(data.paginacion.totalPages)} · ${e(data.paginacion.total)} operaciones</span>
        <button type="button" class="secondary" data-history-page="${data.paginacion.page + 1}" ${data.paginacion.hasNextPage ? '' : 'disabled'}>Siguiente</button>
      </div>`;
    }

    async function renderHistory() {
      const request = ++ui.request;
      view.querySelector('[data-compensation-content]').innerHTML = '<div class="loading-state" role="status">Cargando compensaciones...</div>';
      const params = new URLSearchParams({ ...ui.filters, page: ui.page, pageSize: 25 });
      try {
        const data = await api(`/api/compensaciones?${params}`);
        if (request !== ui.request) return;
        view.querySelector('[data-compensation-content]').innerHTML = historyMarkup(data);
        wireHistory();
      } catch (error) {
        if (request !== ui.request) return;
        view.querySelector('[data-compensation-content]').innerHTML =
          `<div class="error-state" role="alert">${e(error.message)} <button type="button" data-compensation-retry>Reintentar</button></div>`;
        view.querySelector('[data-compensation-retry]').addEventListener('click', renderHistory);
      }
    }

    function wireHistory() {
      view.querySelectorAll('[data-history-page]:not([disabled])').forEach((button) => button.addEventListener('click', () => {
        ui.page = Number(button.dataset.historyPage);
        renderHistory();
      }));
      view.querySelectorAll('[data-compensation-receipt]').forEach((button) => button.addEventListener('click', async () => {
        const [kind, id] = button.dataset.compensationReceipt.split(':');
        try { await openReceipt(kind, id, button); } catch (error) { showError(error.message); }
      }));
      view.querySelectorAll('[data-operation-detail]').forEach((button) => button.addEventListener('click', async () => {
        try {
          const row = await api(`/api/compensaciones/${button.dataset.operationDetail}`);
          openDialog('Detalle de compensacion', `<dl class="compensation-detail-grid">
            <div><dt>Tipo</dt><dd>${e(label(row.tipoOperacion))}</dd></div>
            <div><dt>Estado</dt><dd>${badge(row.estado)}</dd></div>
            <div><dt>Venta</dt><dd>${e(row.codigoVenta || row.idVenta || 'No aplica')}</dd></div>
            <div><dt>Cliente</dt><dd>${e(row.cliente)}</dd></div>
            <div><dt>Motivo</dt><dd>${e(label(row.motivoCodigo))}</dd></div>
            <div><dt>Responsable</dt><dd>${e(row.administrador)}</dd></div>
          </dl><p>${e(row.observacion || 'Sin observacion adicional.')}</p>
          <div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Cerrar</button></div>`, button);
        } catch (error) { showError(error.message); }
      }));
    }

    function saleContextMarkup(data) {
      const sale = data.venta;
      return `<section class="panel compensation-sale-context">
        <div class="panel-title"><div><h3>${e(sale.codigoComprobante || `Venta #${sale.idVenta}`)}</h3>
          <p>${e(sale.cliente)} · ${e(formatDate(sale.fecha))}</p></div>${badge(sale.estadoOperacion)}</div>
        ${saleSummary(data)}
        <div class="actions">
          <button type="button" class="danger" data-sale-cancel ${sale.estadoOperacion === 'anulada' || readOnly() ? 'disabled' : ''}>Anular venta</button>
          <button type="button" data-sale-return ${sale.estadoOperacion === 'anulada' || readOnly() ? 'disabled' : ''}>Devolucion parcial</button>
        </div>
        <h4>Pagos de la venta</h4>
        ${data.pagos.length ? `<div class="compact-list">${data.pagos.map((row) => `<div>
          <span><strong>Pago #${e(row.idPagoVenta)} · Bs ${money(row.monto)}</strong><small>${e(label(row.metodoPago))}</small></span>
          <button type="button" class="small secondary" data-correct-payment="${e(row.idPagoVenta)}" ${row.idCompensacionPagoVenta || readOnly() ? 'disabled' : ''}>Corregir metodo</button>
        </div>`).join('')}</div>` : '<p class="muted">No hay pagos asociados.</p>'}
        <h4>Cobros de fiado asociados</h4>
        ${data.cobros.length ? `<div class="compact-list">${data.cobros.map((row) => `<div>
          <span><strong>Cobro #${e(row.idCobroFiado)} · Bs ${money(row.montoTotal)}</strong><small>${e(label(row.metodoPago))} · ${e(label(row.estadoOperacion))}</small></span>
          <button type="button" class="small secondary" data-compensate-collection="${e(row.idCobroFiado)}" ${row.estadoOperacion === 'compensado' || readOnly() ? 'disabled' : ''}>Compensar cobro</button>
        </div>`).join('')}</div>` : '<p class="muted">No hay cobros de fiado asociados.</p>'}
      </section>`;
    }

    async function loadSale(form) {
      const id = form.elements.idVenta.value;
      const target = view.querySelector('[data-sale-context]');
      target.innerHTML = '<div class="loading-state" role="status">Consultando venta...</div>';
      try {
        ui.sale = await api(`/api/compensaciones/ventas/${encodeURIComponent(id)}/contexto`);
        target.innerHTML = saleContextMarkup(ui.sale);
        target.querySelector('[data-sale-cancel]:not([disabled])')?.addEventListener('click', (event) => openSaleCompensation('anulacion_total', event.currentTarget));
        target.querySelector('[data-sale-return]:not([disabled])')?.addEventListener('click', (event) => openSaleCompensation('devolucion_parcial', event.currentTarget));
        target.querySelectorAll('[data-correct-payment]:not([disabled])').forEach((button) => button.addEventListener('click', () => {
          openPaymentCorrection(ui.sale.pagos.find((row) => String(row.idPagoVenta) === button.dataset.correctPayment), button);
        }));
        target.querySelectorAll('[data-compensate-collection]:not([disabled])').forEach((button) => button.addEventListener('click', () => {
          openCollectionCompensation(ui.sale.cobros.find((row) => String(row.idCobroFiado) === button.dataset.compensateCollection), button);
        }));
      } catch (error) {
        target.innerHTML = `<div class="error-state" role="alert">${e(error.message)}</div>`;
      }
    }

    async function renderPending() {
      const target = view.querySelector('[data-compensation-content]');
      target.innerHTML = '<div class="loading-state" role="status">Cargando liquidaciones pendientes...</div>';
      try {
        const data = await api('/api/compensaciones/pendientes');
        target.innerHTML = `<div class="compensation-pending-grid">
          <section class="panel"><h3>Efectos financieros por resolver</h3>
            ${data.liquidaciones.length ? `<div class="compact-list">${data.liquidaciones.map((row) => `<div>
              <span><strong>${e(row.codigoComprobante || `Venta #${row.idVenta}`)}</strong>
              <small>${e(row.cliente)} · deuda Bs ${money(row.montoReduccionDeudaPendiente)} · reembolso Bs ${money(row.montoReembolsoPendiente)}</small></span>
              <button type="button" class="small" data-resolve-settlement="${e(row.idLiquidacionCompensacionVenta)}" ${readOnly() ? 'disabled' : ''}>Resolver</button>
            </div>`).join('')}</div>` : '<p class="empty-state">No hay efectos financieros pendientes.</p>'}
          </section>
          <section class="panel"><h3>Reembolsos pendientes</h3>
            ${data.reembolsos.length ? `<div class="compact-list">${data.reembolsos.map((row) => `<div>
              <span><strong>${e(row.codigoComprobante || `Venta #${row.idVenta}`)}</strong>
              <small>${e(row.cliente)} · pendiente Bs ${money(row.montoPendiente)}</small></span>
              <button type="button" class="small" data-settle-refund="${e(row.idObligacionReembolsoVenta)}" ${readOnly() ? 'disabled' : ''}>Registrar liquidacion</button>
            </div>`).join('')}</div>` : '<p class="empty-state">No hay reembolsos pendientes.</p>'}
          </section>
        </div>`;
        target.querySelectorAll('[data-resolve-settlement]:not([disabled])').forEach((button) => button.addEventListener('click', () => {
          openSettlement(data.liquidaciones.find((row) => String(row.idLiquidacionCompensacionVenta) === button.dataset.resolveSettlement), 'financial', button);
        }));
        target.querySelectorAll('[data-settle-refund]:not([disabled])').forEach((button) => button.addEventListener('click', () => {
          openSettlement(data.reembolsos.find((row) => String(row.idObligacionReembolsoVenta) === button.dataset.settleRefund), 'material', button);
        }));
      } catch (error) {
        target.innerHTML = `<div class="error-state" role="alert">${e(error.message)}</div>`;
      }
    }

    function renderSales() {
      const target = view.querySelector('[data-compensation-content]');
      target.innerHTML = `<section class="panel"><form class="compensation-sale-search" data-sale-search>
        <label>Numero interno de venta
          <input name="idVenta" type="number" min="1" required inputmode="numeric">
        </label>
        <button type="submit">Consultar venta</button>
      </form></section><div data-sale-context>
        <div class="empty-state">Consulta una venta para revisar su historial antes de compensar.</div>
      </div>`;
      target.querySelector('[data-sale-search]').addEventListener('submit', (event) => {
        event.preventDefault();
        loadSale(event.currentTarget);
      });
    }

    function renderExports() {
      const target = view.querySelector('[data-compensation-content]');
      const hasExportFeature = hasFeature('exportacion_reportes');
      const allowed = hasExportFeature && !readOnly();
      target.innerHTML = `<section class="panel"><h3>Exportaciones compensatorias</h3>
        <p>Los archivos usan los filtros del historial. Los importes separan bruto, compensacion comercial, reembolso material y neto.</p>
        ${allowed ? `<div class="compensation-export-grid">${[
          ['historial', 'Historial'],
          ['devoluciones', 'Devoluciones'],
          ['liquidaciones', 'Liquidaciones y reembolsos'],
          ['finanzas-netas', 'Reporte financiero neto'],
          ['cuentas-por-cobrar', 'Cuentas por cobrar ajustadas'],
          ['metodos-pago', 'Metodos de pago netos']
        ].map(([type, text]) => `<div><strong>${e(text)}</strong>
          <button type="button" class="secondary" data-compensation-export="${type}:csv">CSV</button>
          <button type="button" data-compensation-export="${type}:xlsx">XLSX</button></div>`).join('')}</div>`
          : `<p class="credit-plan-note">${hasExportFeature
            ? 'La suscripcion debe estar activa para generar exportaciones.'
            : 'Las exportaciones requieren la funcionalidad de exportacion de reportes.'}</p>`}
      </section>`;
      target.querySelectorAll('[data-compensation-export]').forEach((button) => button.addEventListener('click', () => {
        const [type, format] = button.dataset.compensationExport.split(':');
        download(type, format, button);
      }));
    }

    async function switchTab(tab) {
      ui.request += 1;
      ui.tab = tab;
      ui.page = 1;
      view.querySelectorAll('[data-compensation-tab]').forEach((button) => {
        const active = button.dataset.compensationTab === tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      if (tab === 'ventas') return renderSales();
      if (tab === 'pendientes') return renderPending();
      if (tab === 'exportaciones') return renderExports();
      return renderHistory();
    }

    async function render() {
      ui.options ||= await api('/api/compensaciones/opciones');
      view.innerHTML = `<div class="compensation-heading">
        <div><span class="eyebrow">Administracion operativa</span>
          <h3>Compensaciones</h3>
          <p>Corrige operaciones sin borrar ni reescribir el historial original.</p></div>
      </div>
      ${readOnly() ? '<div class="subscription-banner subscription-blocked">La suscripcion permite consulta historica, pero las nuevas compensaciones estan deshabilitadas.</div>' : ''}
      <div class="compensation-tabs" role="tablist" aria-label="Vistas de compensaciones">
        ${[['historial', 'Historial'], ['ventas', 'Ventas'], ['pendientes', 'Pendientes'], ['exportaciones', 'Exportaciones']]
          .map(([value, text]) => `<button type="button" role="tab" data-compensation-tab="${value}"
            aria-selected="${ui.tab === value}" class="${ui.tab === value ? 'active' : ''}">${text}</button>`).join('')}
      </div>
      <section class="panel compensation-filter-panel" ${ui.tab === 'historial' ? '' : 'hidden'} data-history-filters>
        <form class="compensation-filters">
          <label>Desde<input name="fechaDesde" type="date" value="${e(ui.filters.fechaDesde || '')}"></label>
          <label>Hasta<input name="fechaHasta" type="date" value="${e(ui.filters.fechaHasta || '')}"></label>
          <label>Tipo<select name="tipo"><option value="">Todos</option>${ui.options.tipos.map((value) => option(value, label(value), ui.filters.tipo)).join('')}</select></label>
          <label>Estado<select name="estado"><option value="">Todos</option>${ui.options.estados.map((value) => option(value, label(value), ui.filters.estado)).join('')}</select></label>
          <label>Responsable<input name="usuario" value="${e(ui.filters.usuario || '')}" maxlength="80"></label>
          <label>Cliente<input name="cliente" value="${e(ui.filters.cliente || '')}" maxlength="120"></label>
          <label>Venta<input name="venta" type="number" min="1" value="${e(ui.filters.venta || '')}"></label>
          <div class="credit-filter-actions"><button type="submit">Aplicar</button><button type="reset" class="secondary">Limpiar</button></div>
        </form>
      </section>
      <div data-compensation-content aria-live="polite"></div>`;
      view.querySelectorAll('[data-compensation-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.compensationTab)));
      const filterPanel = view.querySelector('[data-history-filters]');
      filterPanel.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        ui.filters = Object.fromEntries([...new FormData(event.currentTarget).entries()].filter(([, value]) => value !== ''));
        ui.page = 1;
        renderHistory();
      });
      filterPanel.querySelector('form').addEventListener('reset', () => {
        setTimeout(() => {
          ui.filters = {};
          ui.page = 1;
          renderHistory();
        }, 0);
      });
      await switchTab(ui.tab);
    }

    return { render };
  }

  global.CompensationUI = { create };
}(window));
