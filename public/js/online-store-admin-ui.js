(function initializeOnlineStoreAdminUi(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function checked(value) { return value ? 'checked' : ''; }
  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function create({ root, api, isReadOnly = () => false, patterns = global.UiPatterns } = {}) {
    if (!root || !api) throw new Error('La tienda online requiere un contenedor y un cliente API.');
    let model = null;
    let products = [];
    let orders = [];
    let search = '';
    let activeView = 'orders';
    let orderStatus = 'todos';
    let announcementTimer = null;
    let announcementSequence = 0;

    function messageFor(error) {
      return patterns?.messageFor?.(error) || error?.message || 'No se pudo completar la operación.';
    }

    function publicUrl() {
      return model?.enlacePublico ? `${global.location.origin}${model.enlacePublico}` : '';
    }

    function renderProductList() {
      const container = root.querySelector('[data-online-product-list]');
      if (!container) return;
      const filtered = products.filter((product) => normalized(`${product.nombre} ${product.categoria}`).includes(normalized(search)));
      if (!filtered.length) {
        container.innerHTML = '<div class="online-store-empty"><strong>No encontramos productos</strong><p>Prueba con otro nombre o categoría.</p></div>';
        return;
      }
      container.innerHTML = filtered.map((product) => `
        <article class="online-product-card${product.publicado ? ' is-published' : ''}" data-online-product="${product.idProducto}">
          <div class="online-product-main">
            <div class="online-product-icon" aria-hidden="true">${escapeHtml(product.nombre.slice(0, 1).toUpperCase())}</div>
            <div class="online-product-copy">
              <span class="online-product-category">${escapeHtml(product.categoria)}</span>
              <h5>${escapeHtml(product.nombre)}</h5>
              <p>Bs ${Number(product.precioVenta).toFixed(2)} · ${product.stockUnidadesTotal > 0 ? 'Disponible' : 'Agotado'}</p>
            </div>
          </div>
          <label class="online-visibility-card">
            <span><strong>${product.publicado ? 'Visible en la tienda' : 'Oculto para clientes'}</strong><small>${product.publicado ? 'El cliente puede agregarlo a su carrito.' : 'Sigue disponible en tu inventario.'}</small></span>
            <input type="checkbox" name="publicado" ${checked(product.publicado)} ${isReadOnly() ? 'disabled' : ''}>
            <i aria-hidden="true"></i>
          </label>
        </article>`).join('');
      container.querySelectorAll('[data-online-product]').forEach((card) => {
        const publication = card.querySelector('[name="publicado"]');
        const syncState = () => {
          card.classList.toggle('is-published', publication.checked);
          const copy = publication.closest('label').querySelector('span');
          copy.innerHTML = publication.checked
            ? '<strong>Visible en la tienda</strong><small>El cliente puede agregarlo a su carrito.</small>'
            : '<strong>Oculto para clientes</strong><small>Sigue disponible en tu inventario.</small>';
        };
        publication.addEventListener('change', async () => { syncState(); await saveProduct(card); });
        syncState();
      });
    }

    async function saveProduct(card) {
      const idProducto = Number(card.dataset.onlineProduct);
      const control = card.querySelector('[name="publicado"]');
      const payload = { publicado: control.checked };
      control.disabled = true;
      try {
        const result = await api(`/api/tienda-online/productos/${idProducto}`, { method: 'PATCH', body: JSON.stringify(payload) });
        const index = products.findIndex((product) => product.idProducto === idProducto);
        if (index >= 0) products[index] = result.producto;
        renderProductList();
        setAnnouncement(`${result.producto.nombre} quedó ${result.producto.publicado ? 'publicado' : 'oculto'}.`);
      } catch (error) {
        setAnnouncement(messageFor(error), true);
        control.checked = !control.checked;
        control.disabled = isReadOnly();
        renderProductList();
      }
    }

    function setAnnouncement(text, error = false, action = null) {
      const target = root.querySelector('[data-online-announcement]');
      if (!target) return;
      announcementSequence += 1;
      const sequence = announcementSequence;
      if (announcementTimer) global.clearTimeout(announcementTimer);
      target.innerHTML = `<span>${escapeHtml(text)}</span>${action ? `<button type="button" class="secondary" data-announcement-action>${escapeHtml(action.label)}</button>` : ''}${error ? '<button type="button" class="online-announcement-close" data-announcement-close aria-label="Cerrar alerta">×</button>' : ''}`;
      target.classList.toggle('error', error);
      target.querySelector('[data-announcement-action]')?.addEventListener('click', () => action.onClick?.());
      target.querySelector('[data-announcement-close]')?.addEventListener('click', () => {
        announcementSequence += 1;
        target.innerHTML = '';
        target.classList.remove('error');
      });
      if (error) {
        announcementTimer = null;
        return;
      }
      announcementTimer = global.setTimeout(() => {
        if (sequence !== announcementSequence) return;
        const currentTarget = root.querySelector('[data-online-announcement]');
        if (!currentTarget) return;
        currentTarget.innerHTML = '';
        currentTarget.classList.remove('error');
        announcementTimer = null;
      }, 2000);
    }

    function orderLabel(value) {
      return ({ pendiente: 'Nuevo', confirmado: 'Confirmado', preparando: 'Preparando', listo: 'Listo para entregar', entregado: 'Entregado', cancelado: 'Cancelado' })[value] || value;
    }

    function orderNumberLabel(order) {
      return String(Number(order.numeroPedido || order.idPedidoOnline || 0)).padStart(3, '0');
    }

    function nextOrderAction(order) {
      if (['pendiente', 'confirmado'].includes(order.estado)) return { label: 'Alistar pedido', estado: 'preparando', estadoPago: 'pendiente' };
      if (order.estado === 'preparando') return { label: 'Pedido terminado', estado: 'listo', estadoPago: 'pendiente', mensaje: 'Pedido listo. El stock se descontó del inventario.' };
      if (order.estado === 'listo') return { label: 'Marcar entregado', estado: 'entregado', estadoPago: 'pagado', mensaje: 'Pedido entregado. La venta ya aparece en tus reportes.' };
      return null;
    }

    function confirmOrderCancellation(order, returnFocus) {
      const modalRoot = global.document.getElementById('modalRoot');
      if (!modalRoot || !order) return Promise.resolve(false);
      const orderNumber = orderNumberLabel(order);
      const stockMessage = order.estado === 'listo'
        ? 'Los productos ya descontados volverán al stock automáticamente.'
        : 'Las unidades reservadas volverán a quedar disponibles en el stock.';
      return new Promise((resolve) => {
        const close = (confirmed) => {
          modalRoot.innerHTML = '';
          returnFocus?.focus?.();
          resolve(confirmed);
        };
        modalRoot.innerHTML = `
          <div class="modal-backdrop" data-order-cancel-backdrop>
            <section class="modal online-order-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="onlineCancelTitle" aria-describedby="onlineCancelDescription">
              <span class="online-order-cancel-icon" aria-hidden="true">!</span>
              <div>
                <p class="eyebrow">PEDIDO ${escapeHtml(orderNumber)}</p>
                <h3 id="onlineCancelTitle">¿Cancelar este pedido?</h3>
                <p id="onlineCancelDescription">Confirma que deseas cancelar el pedido de <strong>${escapeHtml(order.nombreCliente)}</strong>.</p>
              </div>
              <div class="online-order-cancel-impact"><strong>Qué ocurrirá</strong><p>${escapeHtml(stockMessage)}</p><small>El pedido quedará cancelado y esta acción no se puede deshacer.</small></div>
              <div class="modal-actions">
                <button type="button" class="secondary" data-modal-cancel>Volver</button>
                <button type="button" class="danger" data-modal-confirm>Sí, cancelar pedido</button>
              </div>
            </section>
          </div>`;
        modalRoot.querySelector('[data-modal-cancel]').addEventListener('click', () => close(false));
        modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', () => close(true));
        modalRoot.querySelector('[data-order-cancel-backdrop]').addEventListener('click', (event) => {
          if (event.target === event.currentTarget) close(false);
        });
        modalRoot.querySelector('[data-modal-cancel]').focus();
      });
    }

    function confirmOrderDelivery(order, returnFocus) {
      const modalRoot = global.document.getElementById('modalRoot');
      if (!modalRoot || !order) return Promise.resolve(null);
      return new Promise((resolve) => {
        const close = (result) => {
          modalRoot.innerHTML = '';
          returnFocus?.focus?.();
          resolve(result);
        };
        modalRoot.innerHTML = `
          <div class="modal-backdrop" data-order-delivery-backdrop>
            <section class="modal online-order-delivery-modal" role="dialog" aria-modal="true" aria-labelledby="onlineDeliveryTitle">
              <div class="online-order-delivery-heading"><div><p class="eyebrow">PEDIDO ${escapeHtml(orderNumberLabel(order))}</p><h3 id="onlineDeliveryTitle">Confirma la entrega y el pago</h3><p>El pedido se marcará como entregado. Elige si ya fue cobrado o si quedará en la cuenta del cliente.</p></div><button type="button" class="icon-button" data-modal-cancel aria-label="Cerrar">×</button></div>
              <div class="online-order-payment-choice" role="radiogroup" aria-label="Estado de pago">
                <label><input type="radio" name="onlineDeliveryPayment" value="pagado" checked><span><strong>Ya está pagado</strong><small>Registra el cobro por ${escapeHtml(order.metodoPago === 'qr' ? 'QR' : 'efectivo')}.</small></span></label>
                <label><input type="radio" name="onlineDeliveryPayment" value="pendiente"><span><strong>Fiado · cobrar después</strong><small>Crea una deuda en la cuenta de ${escapeHtml(order.nombreCliente)}.</small></span></label>
              </div>
              <div class="online-order-credit-fields" data-credit-fields hidden>
                <label>Fecha acordada de pago (opcional)<input type="date" data-credit-due-date></label>
                <label>Observación (opcional)<textarea rows="3" maxlength="1000" data-credit-note placeholder="Ej.: pagará a fin de mes"></textarea></label>
                <small>Si el cliente ya tiene una deuda vencida, escribe el motivo por el que autorizas este nuevo fiado.</small>
              </div>
              <p class="online-order-delivery-error" data-delivery-error role="alert"></p>
              <div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Volver</button><button type="button" data-delivery-confirm>Confirmar entrega</button></div>
            </section>
          </div>`;
        const creditFields = modalRoot.querySelector('[data-credit-fields]');
        const refreshChoice = () => {
          const credit = modalRoot.querySelector('input[name="onlineDeliveryPayment"]:checked')?.value === 'pendiente';
          creditFields.hidden = !credit;
        };
        modalRoot.querySelectorAll('input[name="onlineDeliveryPayment"]').forEach((input) => input.addEventListener('change', refreshChoice));
        modalRoot.querySelectorAll('[data-modal-cancel]').forEach((button) => button.addEventListener('click', () => close(null)));
        modalRoot.querySelector('[data-order-delivery-backdrop]').addEventListener('click', (event) => {
          if (event.target === event.currentTarget) close(null);
        });
        modalRoot.querySelector('[data-delivery-confirm]').addEventListener('click', () => {
          const estadoPago = modalRoot.querySelector('input[name="onlineDeliveryPayment"]:checked')?.value || 'pagado';
          const observacionCredito = modalRoot.querySelector('[data-credit-note]').value.trim();
          close({
            estadoPago,
            fechaVencimiento: modalRoot.querySelector('[data-credit-due-date]').value || null,
            observacionCredito: observacionCredito || null,
            confirmarDeudaVencida: estadoPago === 'pendiente' && Boolean(observacionCredito)
          });
        });
        refreshChoice();
        modalRoot.querySelector('[data-delivery-confirm]').focus();
      });
    }

    function openOrderEditor(order, returnFocus) {
      const modalRoot = global.document.getElementById('modalRoot');
      if (!modalRoot || !order || !['pendiente', 'confirmado', 'preparando'].includes(order.estado)) return;
      const lines = order.productos.map((item) => ({
        ...item,
        originalQuantity: Number(item.cantidad),
        cantidad: Number(item.cantidad)
      }));
      const close = () => {
        modalRoot.innerHTML = '';
        returnFocus?.focus?.();
      };
      modalRoot.innerHTML = `
        <div class="modal-backdrop">
          <section class="modal online-order-edit-modal" role="dialog" aria-modal="true" aria-labelledby="onlineEditTitle">
            <div class="online-order-edit-heading"><div><p class="eyebrow">PEDIDO ${escapeHtml(orderNumberLabel(order))}</p><h3 id="onlineEditTitle">Editar productos del pedido</h3><p>Reduce cantidades o quita lo que no podrás entregar. El cliente no tendrá que armar el pedido nuevamente.</p></div><button type="button" class="icon-button" data-modal-cancel aria-label="Cerrar">×</button></div>
            <div class="online-order-edit-list" data-order-edit-list></div>
            <p class="online-order-edit-error" data-order-edit-error role="alert"></p>
            <div class="online-order-edit-summary"><span>Nuevo subtotal</span><strong data-order-edit-total></strong></div>
            <div class="modal-actions"><button type="button" class="secondary" data-modal-cancel>Volver</button><button type="button" data-order-edit-save>Guardar cambios</button></div>
          </section>
        </div>`;
      const list = modalRoot.querySelector('[data-order-edit-list]');
      const errorTarget = modalRoot.querySelector('[data-order-edit-error]');
      const renderLines = () => {
        list.innerHTML = lines.length ? lines.map((item) => `
          <article class="online-order-edit-line" data-order-edit-line="${item.idDetallePedidoOnline}">
            <div><strong>${escapeHtml(item.nombreProductoSnapshot)}</strong><small>Bs ${Number(item.precioUnitario).toFixed(2)} por unidad</small></div>
            <div class="online-order-edit-controls"><button type="button" class="secondary" data-edit-decrease aria-label="Disminuir ${escapeHtml(item.nombreProductoSnapshot)}" ${item.cantidad <= 1 ? 'disabled' : ''}>−</button><input type="number" min="1" max="${item.originalQuantity}" value="${item.cantidad}" data-edit-quantity aria-label="Cantidad de ${escapeHtml(item.nombreProductoSnapshot)}"><button type="button" class="secondary" data-edit-increase aria-label="Aumentar ${escapeHtml(item.nombreProductoSnapshot)}" ${item.cantidad >= item.originalQuantity ? 'disabled' : ''}>+</button><button type="button" class="online-order-edit-remove" data-edit-remove>Quitar</button></div>
          </article>`).join('') : '<div class="online-store-empty"><strong>El pedido quedó sin productos</strong><p>Conserva al menos uno o cancela el pedido completo.</p></div>';
        modalRoot.querySelector('[data-order-edit-total]').textContent = `Bs ${lines.reduce((sum, item) => sum + Number(item.precioUnitario) * item.cantidad, 0).toFixed(2)}`;
        list.querySelectorAll('[data-order-edit-line]').forEach((line) => {
          const item = lines.find((candidate) => String(candidate.idDetallePedidoOnline) === line.dataset.orderEditLine);
          line.querySelector('[data-edit-decrease]')?.addEventListener('click', () => { item.cantidad = Math.max(1, item.cantidad - 1); errorTarget.textContent = ''; renderLines(); });
          line.querySelector('[data-edit-increase]')?.addEventListener('click', () => { item.cantidad = Math.min(item.originalQuantity, item.cantidad + 1); errorTarget.textContent = ''; renderLines(); });
          line.querySelector('[data-edit-quantity]')?.addEventListener('change', (event) => { item.cantidad = Math.min(item.originalQuantity, Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1)); errorTarget.textContent = ''; renderLines(); });
          line.querySelector('[data-edit-remove]')?.addEventListener('click', () => { lines.splice(lines.indexOf(item), 1); errorTarget.textContent = ''; renderLines(); });
        });
      };
      modalRoot.querySelectorAll('[data-modal-cancel]').forEach((button) => button.addEventListener('click', close));
      modalRoot.querySelector('[data-order-edit-save]').addEventListener('click', async (event) => {
        if (!lines.length) {
          errorTarget.textContent = 'El pedido debe conservar al menos un producto. Si no entregarás ninguno, cancélalo.';
          return;
        }
        const button = event.currentTarget;
        button.disabled = true;
        errorTarget.textContent = '';
        try {
          await api(`/api/tienda-online/pedidos/${order.idPedidoOnline}/productos`, {
            method: 'PATCH',
            body: JSON.stringify({ productos: lines.map((item) => ({ idDetallePedidoOnline: item.idDetallePedidoOnline, cantidad: item.cantidad })) })
          });
          close();
          const data = await api('/api/tienda-online/pedidos?estado=todos');
          orders = data.pedidos;
          renderOrderSummary();
          renderOrders();
          setAnnouncement('Pedido actualizado. Las unidades retiradas volvieron a quedar disponibles.');
        } catch (error) {
          button.disabled = false;
          errorTarget.textContent = messageFor(error);
        }
      });
      renderLines();
      modalRoot.querySelector('[data-order-edit-save]').focus();
    }

    async function updateOrder(card, estado, estadoPago, successMessage, extraBody = {}) {
      const buttons = [...card.querySelectorAll('button')];
      const scrollTop = global.scrollY;
      buttons.forEach((button) => { button.disabled = true; });
      try {
        await api(`/api/tienda-online/pedidos/${card.dataset.onlineOrder}`, {
          method: 'PATCH',
          body: JSON.stringify({ estado, estadoPago, ...extraBody })
        });
        setAnnouncement(successMessage);
        const data = await api('/api/tienda-online/pedidos?estado=todos');
        orders = data.pedidos;
        renderOrderSummary();
        renderOrders();
        global.scrollTo({ top: scrollTop, behavior: 'auto' });
      } catch (error) {
        buttons.forEach((button) => { button.disabled = isReadOnly(); });
        const currentOrder = orders.find((item) => Number(item.idPedidoOnline) === Number(card.dataset.onlineOrder));
        const canEdit = currentOrder && ['pendiente', 'confirmado', 'preparando'].includes(currentOrder.estado) && !isReadOnly();
        setAnnouncement(messageFor(error), true, canEdit ? {
          label: 'Editar pedido',
          onClick: () => openOrderEditor(currentOrder, card.querySelector('[data-order-edit], [data-order-advance]'))
        } : null);
      }
    }

    function renderOrders() {
      const target = root.querySelector('[data-online-orders]');
      if (!target) return;
      const visibleOrders = orderStatus === 'todos'
        ? orders
        : orders.filter((order) => {
          if (orderStatus === 'preparando') return ['confirmado', 'preparando'].includes(order.estado);
          if (orderStatus === 'finalizados') return ['entregado', 'cancelado'].includes(order.estado);
          return order.estado === orderStatus;
        });
      if (!visibleOrders.length) {
        target.innerHTML = `<div class="online-store-empty"><strong>${orders.length ? 'No hay pedidos en este estado' : 'Aún no llegaron pedidos'}</strong><p>${orders.length ? 'Prueba con otro filtro para revisar tus pedidos.' : 'Cuando un cliente envíe su carrito, aparecerá aquí con sus datos y productos.'}</p></div>`;
        return;
      }
      target.innerHTML = visibleOrders.map((order) => {
        const action = nextOrderAction(order);
        const productCount = order.productos.reduce((total, item) => total + Number(item.cantidad || 0), 0);
        const finalState = ['entregado', 'cancelado'].includes(order.estado);
        const manyProducts = order.productos.length > 12;
        const productRows = `<ul>${order.productos.map((item) => `<li><span>${item.cantidad} × ${escapeHtml(item.nombreProductoSnapshot)}</span><strong>Bs ${Number(item.subtotal).toFixed(2)}</strong></li>`).join('')}</ul>`;
        const productDetails = manyProducts
          ? `<details class="online-order-products is-collapsible"><summary><span>${productCount} ${productCount === 1 ? 'producto' : 'productos'}</span><small>Mostrar pedido completo</small></summary>${productRows}</details>`
          : `<section class="online-order-products is-expanded"><div class="online-order-products-heading"><strong>${productCount} ${productCount === 1 ? 'producto' : 'productos'}</strong></div>${productRows}</section>`;
        const progressStatus = order.estado === 'confirmado' ? 'preparando' : order.estado;
        const progress = ['pendiente', 'preparando', 'listo', 'entregado'];
        const progressIndex = progress.indexOf(progressStatus);
        return `<article class="online-order-card" data-online-order="${order.idPedidoOnline}" data-online-state="${order.estado}">
          <header><div><span class="eyebrow">PEDIDO ${orderNumberLabel(order)}</span><h5>${escapeHtml(order.nombreCliente)}</h5><p>${escapeHtml(order.telefonoCliente)} · ${order.tipoEntrega === 'entrega' ? 'Entrega a domicilio' : 'Recojo en tienda'} · ${order.franjaEntrega}</p></div><strong>Bs ${Number(order.total).toFixed(2)}</strong></header>
          ${productDetails}
          ${order.direccionEntrega ? `<p class="online-order-address"><strong>Dirección:</strong> ${escapeHtml(order.direccionEntrega)}</p>` : ''}
          <div class="online-order-card-bottom">
            <ol class="online-order-progress${order.estado === 'cancelado' ? ' is-cancelled' : ''}" aria-label="Progreso del pedido">${progress.map((state, index) => `<li class="${index < progressIndex ? 'done' : index === progressIndex ? 'active' : ''}"><i aria-hidden="true">${index < progressIndex ? '✓' : index + 1}</i><span>${({ pendiente: 'Nuevo', preparando: 'Preparando', listo: 'Listo', entregado: 'Entregado' })[state]}</span></li>`).join('')}</ol>
            ${order.estado === 'cancelado' ? '<p class="online-order-cancelled">Pedido cancelado</p>' : ''}
            ${order.estado === 'cancelado' ? '' : `<footer><div class="online-payment-status"><span>Estado</span><strong>${order.estadoPago === 'pagado' ? 'Pagado' : order.estado === 'entregado' ? 'Fiado' : 'Pendiente'}</strong></div><div class="online-order-actions">${['pendiente', 'confirmado', 'preparando'].includes(order.estado) ? `<button type="button" class="secondary online-order-edit-button" data-order-edit ${isReadOnly() ? 'disabled' : ''}>Editar pedido</button>` : ''}${action ? `<button type="button" data-order-advance data-next-state="${action.estado}" data-next-payment="${action.estadoPago}" ${isReadOnly() ? 'disabled' : ''}>${action.label}</button>` : order.estado === 'entregado' ? '<span class="online-order-finished">Pedido completado</span>' : ''}${!finalState ? `<button type="button" class="online-order-cancel-button" data-order-cancel ${isReadOnly() ? 'disabled' : ''}>Cancelar pedido</button>` : ''}</div></footer>`}
          </div>
        </article>`;
      }).join('');
      target.querySelectorAll('[data-online-order]').forEach((card) => {
        card.querySelector('[data-order-edit]')?.addEventListener('click', (event) => {
          const currentOrder = orders.find((item) => Number(item.idPedidoOnline) === Number(card.dataset.onlineOrder));
          openOrderEditor(currentOrder, event.currentTarget);
        });
        card.querySelector('[data-order-advance]')?.addEventListener('click', async (event) => {
          const button = event.currentTarget;
          const currentOrder = orders.find((item) => Number(item.idPedidoOnline) === Number(card.dataset.onlineOrder));
          const action = currentOrder ? nextOrderAction(currentOrder) : null;
          if (button.dataset.nextState === 'entregado') {
            const delivery = await confirmOrderDelivery(currentOrder, button);
            if (!delivery) return;
            const message = delivery.estadoPago === 'pagado'
              ? 'Pedido entregado y cobrado. La venta ya aparece en tus reportes.'
              : 'Pedido entregado a fiado. La deuda ya aparece en Cobranza.';
            void updateOrder(card, 'entregado', delivery.estadoPago, message, delivery);
            return;
          }
          void updateOrder(card, button.dataset.nextState, button.dataset.nextPayment, action?.mensaje || 'El pedido avanzó al siguiente paso.');
        });
        card.querySelector('[data-order-cancel]')?.addEventListener('click', async (event) => {
          const currentOrder = orders.find((item) => Number(item.idPedidoOnline) === Number(card.dataset.onlineOrder));
          if (!await confirmOrderCancellation(currentOrder, event.currentTarget)) return;
          const message = card.dataset.onlineState === 'listo'
            ? 'Pedido cancelado. El stock se repuso en el inventario.'
            : 'El pedido quedó cancelado.';
          void updateOrder(card, 'cancelado', 'pendiente', message);
        });
      });
    }

    function renderOrderSummary() {
      const counts = orders.reduce((result, order) => {
        result[order.estado] = (result[order.estado] || 0) + 1;
        return result;
      }, {});
      root.querySelectorAll('[data-order-count]').forEach((target) => {
        const states = target.dataset.orderCount.split(',');
        target.textContent = states.reduce((total, state) => total + (counts[state] || 0), 0);
      });
      root.querySelectorAll('[data-online-status]').forEach((button) => {
        button.classList.toggle('active', button.dataset.onlineStatus === orderStatus);
        button.setAttribute('aria-pressed', String(button.dataset.onlineStatus === orderStatus));
      });
    }

    function applyActiveView() {
      root.querySelectorAll('[data-online-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.onlinePanel !== activeView;
      });
      root.querySelectorAll('[data-online-view]').forEach((button) => {
        const selected = button.dataset.onlineView === activeView;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
      });
    }

    function render() {
      const config = model.configuracion;
      const enabledCount = products.filter((product) => product.publicado).length;
      root.innerHTML = `
        <section class="online-store-admin">
          <header class="online-store-hero">
            <div class="online-store-brand"><img src="/assets/administrau-icon.png" alt=""><div><p class="eyebrow">PEDIDOS DE TUS CLIENTES</p><h3>Tu tienda online</h3><p>Revisa lo nuevo, organiza la preparación y mantén cada entrega bajo control.</p></div></div>
            <div class="online-store-status ${config.activa ? 'is-active' : ''}"><span>${config.activa ? 'En línea' : 'Sin publicar'}</span><strong>${enabledCount} productos visibles</strong></div>
          </header>

          <nav class="online-store-workspace-nav" role="tablist" aria-label="Secciones de tienda online">
            <button type="button" data-online-view="orders" role="tab"><span class="online-nav-icon">▤</span><span><strong>Pedidos</strong><small>Revisa y prepara pedidos</small></span><b data-order-count="pendiente,confirmado,preparando,listo">0</b></button>
            <button type="button" data-online-view="config" role="tab"><span class="online-nav-icon">⚙</span><span><strong>Configurar tienda</strong><small>Entrega, pagos y enlace</small></span></button>
            <button type="button" data-online-view="products" role="tab"><span class="online-nav-icon">▦</span><span><strong>Productos</strong><small>Define qué verá el cliente</small></span><b>${enabledCount}</b></button>
          </nav>
          <div class="online-store-announcement" data-online-announcement role="status" aria-live="polite"></div>

          <section class="online-catalog-manager online-orders-manager" data-online-panel="orders">
            <div class="online-section-heading"><span>1</span><div><h4>Pedidos recibidos</h4><p>Revisa lo nuevo, alista cada pedido y completa la entrega paso a paso.</p></div></div>
            <div class="online-order-summary">
              <article><span>Nuevos</span><strong data-order-count="pendiente">0</strong><small>Esperan ser alistados</small></article>
              <article><span>En preparación</span><strong data-order-count="confirmado,preparando">0</strong><small>Se están armando</small></article>
              <article><span>Listos</span><strong data-order-count="listo">0</strong><small>Para entregar o recoger</small></article>
              <article><span>Entregados</span><strong data-order-count="entregado">0</strong><small>Pedidos completados</small></article>
            </div>
            <div class="online-order-filters" role="group" aria-label="Filtrar pedidos por estado">
              <button type="button" data-online-status="todos">Todos</button><button type="button" data-online-status="pendiente">Nuevos</button><button type="button" data-online-status="preparando">Preparando</button><button type="button" data-online-status="listo">Listos</button><button type="button" data-online-status="finalizados">Finalizados</button>
            </div>
            <div class="online-order-list" data-online-orders></div>
          </section>

          <div data-online-panel="config" hidden>
            <section class="online-store-link-card">
              <div><span class="eyebrow">ENLACE DE TU TIENDA</span><h4>${config.activa ? 'Listo para compartir' : 'Actívalo cuando termines de prepararlo'}</h4><p>${escapeHtml(publicUrl())}</p></div>
              <div class="online-store-link-actions"><button type="button" class="secondary" data-copy-online-link>Copiar enlace</button><a class="button-link" href="${escapeHtml(model.enlacePublico)}" target="_blank" rel="noopener">Vista del cliente</a></div>
            </section>

            <div class="online-store-admin-grid">
            <section class="online-store-settings-card">
              <div class="online-section-heading"><span>2</span><div><h4>Configura la experiencia</h4><p>Activa las alternativas que podrá elegir el cliente al finalizar su carrito.</p></div></div>
              <form data-online-config-form>
                <label class="online-option-card online-activation"><span class="online-option-icon">↗</span><span><strong>Publicar tienda online</strong><small>Al activarla, cualquier persona con el enlace podrá ver el catálogo.</small></span><input name="activa" type="checkbox" ${checked(config.activa)}><i aria-hidden="true"></i></label>
                <label>Mensaje de bienvenida<textarea name="mensajeBienvenida" maxlength="300" rows="3" placeholder="Ej.: Elige tus productos y nosotros preparamos tu pedido.">${escapeHtml(config.mensajeBienvenida)}</textarea></label>
                <fieldset class="online-choice-grid"><legend>Opciones que podrá escoger el cliente</legend><label class="online-option-card"><span class="online-option-icon">⌂</span><span><strong>Recojo en tienda</strong><small>El cliente elige mañana, tarde o noche.</small></span><input name="permiteRecojo" type="checkbox" ${checked(config.permiteRecojo)}><i aria-hidden="true"></i></label><label class="online-option-card"><span class="online-option-icon">⌖</span><span><strong>Entrega a domicilio</strong><small>La dirección y el horario se piden al confirmar.</small></span><input name="permiteEntrega" type="checkbox" ${checked(config.permiteEntrega)}><i aria-hidden="true"></i></label></fieldset>
                <fieldset class="online-choice-grid"><legend>Formas de pago disponibles</legend><label class="online-option-card"><span class="online-option-icon">Bs</span><span><strong>Efectivo</strong><small>Pago al recoger o recibir.</small></span><input name="permiteEfectivo" type="checkbox" ${checked(config.permiteEfectivo)}><i aria-hidden="true"></i></label><label class="online-option-card"><span class="online-option-icon">QR</span><span><strong>Pago por QR</strong><small>La tienda coordina el comprobante.</small></span><input name="permiteQr" type="checkbox" ${checked(config.permiteQr)}><i aria-hidden="true"></i></label></fieldset>
                <div class="online-delivery-settings"><div><strong>Condiciones para entrega</strong><p>Si el pedido no alcanza el monto indicado, se suma el costo base. La tienda puede confirmar un ajuste según la distancia.</p></div><div class="online-field-grid"><label>Entrega sin costo desde (Bs)<input name="entregaGratisDesde" type="number" min="0" step="0.01" value="${config.entregaGratisDesde ?? config.pedidoMinimo}"></label><label>Costo base si no alcanza (Bs)<input name="costoEntrega" type="number" min="0" step="0.01" value="${config.costoEntrega}"></label></div></div>
                ${isReadOnly() ? '<p class="readonly-note">Puedes revisar esta configuración, pero tu suscripción está en modo de solo lectura.</p>' : '<button type="submit">Guardar configuración</button>'}
              </form>
            </section>

            <aside class="online-store-preview-card">
              <span class="eyebrow">VISTA PREVIA</span><div class="online-preview-phone"><div class="online-preview-logo"><img src="/assets/administrau-icon.png" alt=""></div><strong>${escapeHtml(document.getElementById('storeName')?.textContent || 'Mi tienda')}</strong><p>${escapeHtml(config.mensajeBienvenida || 'Tu catálogo, claro y fácil de consultar.')}</p><div class="online-preview-search">Buscar productos</div><div class="online-preview-items"><span></span><span></span><span></span></div></div>
              <p>El catálogo se adapta automáticamente a celulares y no muestra cantidades exactas de stock.</p>
            </aside>
            </div>
          </div>

          <section class="online-catalog-manager" data-online-panel="products" hidden>
            <div class="online-section-heading"><span>3</span><div><h4>Productos de tu tienda</h4><p>Todos se muestran por defecto. Desactiva únicamente los que quieras ocultar al cliente.</p></div></div>
            <div class="online-catalog-toolbar"><label>Buscar producto<input type="search" data-online-product-search placeholder="Nombre o categoría"></label><div><strong>${enabledCount}</strong><span>publicados de ${products.length}</span></div></div>
            <div class="online-product-list" data-online-product-list></div>
          </section>
        </section>`;

      const form = root.querySelector('[data-online-config-form]');
      if (isReadOnly()) form.querySelectorAll('input,textarea').forEach((control) => { control.disabled = true; });
      form.addEventListener('submit', saveConfiguration);
      root.querySelector('[data-copy-online-link]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(publicUrl());
          setAnnouncement('Enlace copiado. Ya puedes compartirlo con tus clientes.');
        } catch (_) {
          setAnnouncement('No se pudo copiar automáticamente. Selecciona el enlace mostrado arriba.', true);
        }
      });
      root.querySelector('[data-online-product-search]').addEventListener('input', (event) => {
        search = event.target.value;
        renderProductList();
      });
      root.querySelectorAll('[data-online-view]').forEach((button) => button.addEventListener('click', () => {
        activeView = button.dataset.onlineView;
        applyActiveView();
      }));
      root.querySelectorAll('[data-online-status]').forEach((button) => button.addEventListener('click', () => {
        orderStatus = button.dataset.onlineStatus;
        renderOrderSummary();
        renderOrders();
      }));
      renderProductList();
      renderOrderSummary();
      renderOrders();
      applyActiveView();
    }

    async function saveConfiguration(event) {
      event.preventDefault();
      if (isReadOnly()) return;
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const value = (name) => form.elements[name];
      const payload = {
        activa: value('activa').checked,
        mensajeBienvenida: value('mensajeBienvenida').value,
        permiteRecojo: value('permiteRecojo').checked,
        permiteEntrega: value('permiteEntrega').checked,
        permiteEfectivo: value('permiteEfectivo').checked,
        permiteQr: value('permiteQr').checked,
        entregaGratisDesde: value('entregaGratisDesde').value,
        costoEntrega: value('costoEntrega').value,
        tiempoPreparacionMinutos: 30
      };
      button.disabled = true;
      button.textContent = 'Guardando…';
      try {
        model = await api('/api/tienda-online/configuracion', { method: 'PUT', body: JSON.stringify(payload) });
        render();
        setAnnouncement('La configuración de tu tienda online quedó guardada.');
      } catch (error) {
        setAnnouncement(messageFor(error), true);
        button.disabled = false;
        button.textContent = 'Guardar configuración';
      }
    }

    async function renderView() {
      root.innerHTML = '<section class="online-store-admin loading-panel" aria-busy="true"><p>Preparando tu tienda online…</p></section>';
      try {
        [model, { productos: products }, { pedidos: orders }] = await Promise.all([
          api('/api/tienda-online/configuracion'),
          api('/api/tienda-online/productos'),
          api('/api/tienda-online/pedidos?estado=todos')
        ]);
        render();
      } catch (error) {
        root.innerHTML = `<section class="panel empty-state" role="alert"><h3>No se pudo abrir la tienda online</h3><p>${escapeHtml(messageFor(error))}</p></section>`;
      }
    }

    return Object.freeze({ render: renderView });
  }

  global.OnlineStoreAdminUI = Object.freeze({ create });
}(window));
