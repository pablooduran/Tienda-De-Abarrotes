(function initializeStorefront() {
  'use strict';
  const root = document.getElementById('storefrontRoot');
  let catalog = null;
  let slug = '';
  let search = '';
  let category = 'todas';
  const cart = new Map();
  const CART_STORAGE_PREFIX = 'administrau.storefront.cart.v1:';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function money(value) { return Number(value || 0).toFixed(2); }
  function digits(value) { return String(value || '').replace(/\D/g, ''); }
  function cartStorageKey() { return `${CART_STORAGE_PREFIX}${slug}`; }
  function saveCartDraft() {
    try {
      const items = [...cart.values()].map(({ producto, cantidad }) => ({ idProducto: producto.idProducto, cantidad }));
      if (items.length) localStorage.setItem(cartStorageKey(), JSON.stringify(items));
      else localStorage.removeItem(cartStorageKey());
    } catch (_) { /* El carrito sigue funcionando aunque el navegador bloquee el almacenamiento. */ }
  }
  function restoreCartDraft() {
    try {
      const items = JSON.parse(localStorage.getItem(cartStorageKey()) || '[]');
      if (!Array.isArray(items)) return;
      items.forEach((item) => {
        const product = catalog.productos.find((row) => Number(row.idProducto) === Number(item.idProducto));
        const quantity = Number(item.cantidad);
        if (product && product.disponibilidad !== 'agotado' && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 10000) {
          cart.set(product.idProducto, { producto: product, cantidad: quantity });
        }
      });
    } catch (_) { localStorage.removeItem(cartStorageKey()); }
  }
  function checkoutPhone(form) {
    const local = digits(form.elements.phone.value);
    const country = digits(catalog?.tienda?.codigoPaisTelefono || '591');
    return local.startsWith(country) ? `+${local}` : `+${country}${local}`;
  }
  function availabilityLabel(value) {
    return { disponible: 'Disponible', pocas_unidades: 'Quedan pocas unidades', agotado: 'Agotado' }[value] || 'Consultar';
  }
  function deliverySummary(store) {
    const values = [];
    if (store.opciones.recojo) values.push('Recojo en tienda');
    if (store.opciones.entrega) values.push('Entrega a domicilio');
    return values.join(' · ');
  }
  function cartTotal() {
    return [...cart.values()].reduce((total, item) => total + (item.producto.precioVenta * item.cantidad), 0);
  }
  function deliveryCost() {
    const freeFrom = Number(catalog.tienda.entregaGratisDesde || catalog.tienda.pedidoMinimo || 0);
    return freeFrom > 0 && cartTotal() >= freeFrom ? 0 : Number(catalog.tienda.costoEntrega || 0);
  }

  function renderProducts() {
    const target = root.querySelector('[data-storefront-products]');
    if (!target) return;
    const products = catalog.productos.filter((product) => {
      const matchesCategory = category === 'todas' || product.categoria === category;
      return matchesCategory && normalized(`${product.nombre} ${product.categoria}`).includes(normalized(search));
    });
    root.querySelector('[data-results-count]').textContent = `${products.length} ${products.length === 1 ? 'producto' : 'productos'}`;
    if (!products.length) {
      target.innerHTML = '<section class="storefront-empty"><span aria-hidden="true">⌕</span><h2>No encontramos productos</h2><p>Prueba con otra búsqueda o categoría.</p></section>';
      return;
    }
    target.innerHTML = products.map((product) => {
      const inCart = cart.get(product.idProducto)?.cantidad || 0;
      const soldOut = product.disponibilidad === 'agotado';
      return `<article class="storefront-product${soldOut ? ' is-sold-out' : ''}">
        <div class="storefront-product-visual"><span>${escapeHtml(product.categoria.slice(0, 1).toUpperCase())}</span></div>
        <div class="storefront-product-copy"><span class="storefront-category">${escapeHtml(product.categoria)}</span><h2>${escapeHtml(product.nombre)}</h2><p>Venta por ${escapeHtml(product.unidadMedida)}.</p></div>
        <div class="storefront-product-bottom"><div><strong>Bs ${money(product.precioVenta)}</strong><span class="availability ${product.disponibilidad}">${availabilityLabel(product.disponibilidad)}</span></div><button type="button" data-add-product="${product.idProducto}" ${soldOut ? 'disabled' : ''}>${inCart ? `${inCart} en carrito` : 'Agregar'}</button></div>
      </article>`;
    }).join('');
  }

  function renderCart() {
    const panel = root.querySelector('[data-cart-panel]');
    const count = [...cart.values()].reduce((sum, item) => sum + item.cantidad, 0);
    root.querySelectorAll('[data-cart-count]').forEach((node) => { node.textContent = String(count); });
    if (!panel) return;
    const body = panel.querySelector('[data-cart-items]');
    body.innerHTML = cart.size
      ? [...cart.values()].map(({ producto, cantidad }) => `<article class="storefront-cart-item" data-cart-product="${producto.idProducto}"><div><strong>${escapeHtml(producto.nombre)}</strong><small>Bs ${money(producto.precioVenta)} c/u</small></div><div class="storefront-quantity"><button type="button" data-cart-action="decrease" aria-label="Quitar una unidad">−</button><strong>${cantidad}</strong><button type="button" data-cart-action="increase" aria-label="Agregar una unidad">+</button></div><button type="button" class="storefront-remove" data-cart-action="remove" aria-label="Eliminar ${escapeHtml(producto.nombre)}">×</button></article>`).join('')
      : '<div class="storefront-cart-empty"><span>🛒</span><strong>Tu carrito está vacío</strong><p>Agrega productos y ajusta aquí las cantidades.</p></div>';
    panel.querySelector('[data-cart-subtotal]').textContent = `Bs ${money(cartTotal())}`;
    panel.querySelector('[data-checkout]').disabled = !cart.size;
    saveCartDraft();
    renderProducts();
  }

  function openQuantity(productId) {
    const product = catalog.productos.find((item) => item.idProducto === productId);
    if (!product || product.disponibilidad === 'agotado') return;
    const dialog = root.querySelector('[data-quantity-dialog]');
    dialog.dataset.productId = String(productId);
    dialog.querySelector('[data-quantity-name]').textContent = product.nombre;
    dialog.querySelector('[data-quantity-price]').textContent = `Bs ${money(product.precioVenta)} por ${product.unidadMedida}`;
    dialog.querySelector('[data-quantity-value]').textContent = String(cart.get(productId)?.cantidad || 1);
    dialog.showModal();
  }

  function openCheckout() {
    if (!cart.size) return;
    const dialog = root.querySelector('[data-checkout-dialog]');
    const store = catalog.tienda;
    dialog.querySelector('[data-fulfillment-options]').innerHTML =
      `${store.opciones.recojo ? '<label><input type="radio" name="fulfillment" value="recojo" checked><span><strong>Recojo en tienda</strong><small>Indica cuándo pasarás.</small></span></label>' : ''}${store.opciones.entrega ? `<label><input type="radio" name="fulfillment" value="entrega" ${store.opciones.recojo ? '' : 'checked'}><span><strong>Entrega a domicilio</strong><small>El costo final se confirma según la distancia.</small></span></label>` : ''}`;
    dialog.querySelector('[data-payment-options]').innerHTML =
      `${store.opciones.efectivo ? '<label><input type="radio" name="payment" value="efectivo" checked><span>Efectivo</span></label>' : ''}${store.opciones.qr ? `<label><input type="radio" name="payment" value="qr" ${store.opciones.efectivo ? '' : 'checked'}><span>QR</span></label>` : ''}`;
    dialog.querySelector('[data-checkout-subtotal]').textContent = `Bs ${money(cartTotal())}`;
    dialog.querySelector('[data-delivery-estimate]').textContent = `Bs ${money(deliveryCost())}`;
    dialog.querySelector('[data-delivery-fields]').hidden = Boolean(store.opciones.recojo);
    dialog.querySelector('[data-delivery-row]').hidden = Boolean(store.opciones.recojo);
    dialog.querySelector('[name="address"]').required = !store.opciones.recojo;
    dialog.querySelector('[data-customer-result]').textContent = 'Tu teléfono funciona como identificador dentro de esta tienda.';
    dialog.querySelector('[data-customer-confirmation]').hidden = true;
    dialog.dataset.customerStatus = '';
    dialog.dataset.checkedPhone = '';
    const name = dialog.querySelector('[name="customerName"]');
    name.value = '';
    dialog.querySelector('[data-customer-name]').hidden = true;
    name.placeholder = 'Tu nombre completo';
    dialog.showModal();
    dialog.querySelector('form').scrollTop = 0;
  }

  async function identifyCustomer(dialog) {
    const form = dialog.querySelector('form');
    const localPhone = digits(form.elements.phone.value);
    const phone = checkoutPhone(form);
    const result = dialog.querySelector('[data-customer-result]');
    if (localPhone.length < 7) { result.textContent = 'Ingresa un número de teléfono válido para buscarte.'; return; }
    result.textContent = 'Buscando cliente…';
    try {
      const response = await SecurityHttp.secureFetch(`/api/public/tiendas/${encodeURIComponent(slug)}/clientes/buscar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefono: phone })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw SecurityHttp.errorFromResponse(response, data, 'No pudimos buscar el cliente.');
      const name = dialog.querySelector('[name="customerName"]');
      dialog.dataset.checkedPhone = digits(phone);
      if (data.encontrado) {
        dialog.dataset.customerStatus = 'found';
        name.value = data.cliente.nombre || '';
        dialog.querySelector('[data-customer-name]').hidden = true;
        const confirmation = dialog.querySelector('[data-customer-confirmation]');
        confirmation.innerHTML = `<span>Cliente registrado</span><strong>${escapeHtml(data.cliente.nombre || '')}</strong><small>Usaremos este nombre para enviar el pedido.</small>`;
        confirmation.hidden = false;
        dialog.querySelector('[name="address"]').value ||= data.cliente.direccion || '';
        result.textContent = 'Cliente encontrado. Confirma que eres tú y continúa con la entrega.';
      } else {
        dialog.dataset.customerStatus = 'new';
        dialog.querySelector('[data-customer-confirmation]').hidden = true;
        dialog.querySelector('[data-customer-name]').hidden = false;
        name.value = '';
        name.placeholder = 'Tu nombre completo';
        name.focus();
        result.textContent = 'No hay un cliente asociado. Escribe tu nombre para registrarte con este pedido.';
      }
    } catch (error) {
      result.textContent = error.message || 'No pudimos buscar el cliente.';
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    const form = event.target.closest('form');
    const button = form.querySelector('[data-submit-order]');
    const result = form.querySelector('[data-customer-result]');
    const selected = (name) => form.querySelector(`[name="${name}"]:checked`)?.value;
    const phone = checkoutPhone(form);
    if (digits(form.elements.phone.value).length < 7) {
      result.textContent = 'Ingresa un número de teléfono válido.';
      form.elements.phone.focus();
      return;
    }
    if (form.closest('dialog').dataset.checkedPhone !== digits(phone)) {
      result.textContent = 'Primero presiona “Buscar cliente” para verificar tu teléfono.';
      form.querySelector('[data-find-customer]').focus();
      return;
    }
    if (!form.elements.customerName.value.trim()) {
      result.textContent = 'Escribe tu nombre para registrar el pedido.';
      form.closest('dialog').querySelector('[data-customer-name]').hidden = false;
      form.elements.customerName.focus();
      return;
    }
    if (selected('fulfillment') === 'entrega' && !form.elements.address.value.trim()) {
      result.textContent = 'Escribe la dirección donde debemos entregar el pedido.';
      form.elements.address.focus();
      return;
    }
    const payload = {
      telefono: phone,
      nombre: form.elements.customerName.value,
      tipoEntrega: selected('fulfillment'),
      direccionEntrega: form.elements.address.value,
      franjaEntrega: selected('slot'),
      metodoPago: selected('payment'),
      notas: form.elements.notes.value,
      productos: [...cart.values()].map((item) => ({ idProducto: item.producto.idProducto, cantidad: item.cantidad }))
    };
    button.disabled = true;
    button.textContent = 'Enviando pedido…';
    try {
      const response = await SecurityHttp.secureFetch(`/api/public/tiendas/${encodeURIComponent(slug)}/pedidos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw SecurityHttp.errorFromResponse(response, data, 'No pudimos enviar el pedido.');
      cart.clear();
      saveCartDraft();
      form.closest('dialog').close();
      renderCart();
      const confirmation = root.querySelector('[data-order-confirmation]');
      confirmation.innerHTML = `<strong>¡Pedido enviado!</strong><span>Código ${escapeHtml(data.pedido.codigo)} · Total Bs ${money(data.pedido.total)}</span><small>La tienda lo revisará y coordinará contigo la entrega y el pago.</small>`;
      confirmation.hidden = false;
      confirmation.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      result.textContent = error.message || 'No pudimos enviar el pedido.';
      button.disabled = false;
      button.textContent = 'Enviar pedido a la tienda';
    }
  }

  function render() {
    const store = catalog.tienda;
    document.title = `${store.nombre} · Administrau`;
    root.innerHTML = `
      <section class="storefront-hero"><div class="storefront-hero-pattern" aria-hidden="true"></div><div class="storefront-store-mark"><img src="/assets/administrau-icon.png" alt=""></div><div class="storefront-hero-copy"><p class="eyebrow">TIENDA ONLINE</p><h1>${escapeHtml(store.nombre)}</h1><p>${escapeHtml(store.mensajeBienvenida || 'Elige lo que necesitas y nosotros preparamos tu pedido.')}</p></div><div class="storefront-service-card"><span>Opciones al confirmar</span><strong>${escapeHtml(deliverySummary(store))}</strong><small>Mañana, tarde o noche · ${store.opciones.efectivo ? 'Efectivo' : ''}${store.opciones.efectivo && store.opciones.qr ? ' o ' : ''}${store.opciones.qr ? 'QR' : ''}</small></div></section>
      <section class="storefront-order-confirmation" data-order-confirmation hidden></section>
      <section class="storefront-shop-layout"><div class="storefront-catalog"><header class="storefront-catalog-heading"><div><p class="eyebrow">CATÁLOGO</p><h2>¿Qué estás buscando?</h2></div><span data-results-count></span></header><div class="storefront-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Buscar por nombre o categoría" aria-label="Buscar productos" data-storefront-search></div><div class="storefront-categories" role="group" aria-label="Filtrar por categoría"><button type="button" class="active" data-category="todas">Todos</button>${catalog.categorias.map((item) => `<button type="button" data-category="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}</div><div class="storefront-products" data-storefront-products></div></div>
      <aside class="storefront-cart" data-cart-panel><header><div><p class="eyebrow">TU PEDIDO</p><h2>Carrito <span data-cart-count>0</span></h2></div></header><div class="storefront-cart-items" data-cart-items></div><footer><div><span>Subtotal</span><strong data-cart-subtotal>Bs 0.00</strong></div><button type="button" data-checkout disabled>Continuar pedido</button><small>La disponibilidad y el costo de entrega se confirman con la tienda.</small></footer></aside></section>
      <button type="button" class="storefront-cart-fab" data-open-cart>Carrito · <span data-cart-count>0</span></button>
      <dialog class="storefront-dialog" data-quantity-dialog><form method="dialog"><button class="dialog-close" value="cancel" aria-label="Cerrar">×</button><p class="eyebrow">AGREGAR AL CARRITO</p><h2 data-quantity-name></h2><p data-quantity-price></p><div class="storefront-stepper"><button type="button" data-quantity-action="decrease" aria-label="Quitar una unidad">−</button><strong data-quantity-value>1</strong><button type="button" data-quantity-action="increase" aria-label="Agregar una unidad">+</button></div><button type="button" data-confirm-quantity>Confirmar cantidad</button></form></dialog>
      <dialog class="storefront-dialog storefront-checkout" data-checkout-dialog><form novalidate><button type="button" class="dialog-close" data-close-checkout aria-label="Cerrar">×</button><header class="checkout-intro"><p class="eyebrow">ENVÍA TU PEDIDO</p><h2>Confirma los datos de tu compra</h2><p>Te identificamos, coordinamos la entrega y enviamos el pedido directamente a la tienda.</p></header><section class="checkout-section"><div class="checkout-section-title"><span>1</span><div><strong>Identifícate</strong><small>Tu teléfono es tu identificador en esta tienda.</small></div></div><div class="checkout-phone-row"><label>Número de teléfono<span class="checkout-phone-control"><b>+${escapeHtml(store.codigoPaisTelefono || '591')}</b><input name="phone" type="tel" inputmode="numeric" maxlength="15" required placeholder="76543210"></span></label><button type="button" data-find-customer>Buscar cliente</button></div><p class="checkout-note" data-customer-result role="status" aria-live="polite">Escribe tu número y presiona “Buscar cliente”.</p><label data-customer-name>Nombre completo<input name="customerName" maxlength="100" required placeholder="Tu nombre completo"></label></section><section class="checkout-section"><div class="checkout-section-title"><span>2</span><div><strong>Entrega y pago</strong><small>Elige cómo y cuándo quieres recibirlo.</small></div></div><fieldset><legend>¿Cómo quieres recibirlo?</legend><div class="checkout-choice-grid" data-fulfillment-options></div></fieldset><label class="checkout-address" data-delivery-fields>Dirección de entrega<input type="text" name="address" maxlength="255" placeholder="Zona, calle y referencia"></label><fieldset><legend>¿En qué momento?</legend><div class="checkout-slot-grid"><label><input type="radio" name="slot" value="manana" checked><span>Mañana</span></label><label><input type="radio" name="slot" value="tarde"><span>Tarde</span></label><label><input type="radio" name="slot" value="noche"><span>Noche</span></label></div></fieldset><fieldset><legend>¿Cómo pagarás?</legend><div class="checkout-slot-grid" data-payment-options></div></fieldset></section><section class="checkout-section"><div class="checkout-section-title"><span>3</span><div><strong>Revisa y envía</strong><small>La tienda confirmará disponibilidad y entrega.</small></div></div><label>Nota para la tienda (opcional)<textarea name="notes" maxlength="500" rows="2" placeholder="Alguna referencia o indicación"></textarea></label><div class="checkout-totals"><span>Subtotal <strong data-checkout-subtotal></strong></span><span data-delivery-row>Costo base estimado de entrega <strong data-delivery-estimate></strong></span></div></section><button type="submit" data-submit-order>Enviar pedido a la tienda</button></form></dialog>`;

    const customerConfirmation = document.createElement('div');
    customerConfirmation.className = 'checkout-customer-confirmation';
    customerConfirmation.dataset.customerConfirmation = '';
    customerConfirmation.hidden = true;
    root.querySelector('[data-customer-name]').before(customerConfirmation);
    root.querySelector('[data-customer-name]').hidden = true;

    root.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add-product]');
      if (add) openQuantity(Number(add.dataset.addProduct));
      const action = event.target.closest('[data-cart-action]');
      if (!action) return;
      const id = Number(action.closest('[data-cart-product]').dataset.cartProduct);
      const item = cart.get(id);
      if (!item) return;
      if (action.dataset.cartAction === 'increase') item.cantidad += 1;
      if (action.dataset.cartAction === 'decrease') item.cantidad -= 1;
      if (action.dataset.cartAction === 'remove' || item.cantidad <= 0) cart.delete(id);
      renderCart();
    });
    root.querySelector('[data-storefront-search]').addEventListener('input', (event) => { search = event.target.value; renderProducts(); });
    root.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
      category = button.dataset.category;
      root.querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('active', item === button));
      renderProducts();
    }));
    const quantityDialog = root.querySelector('[data-quantity-dialog]');
    quantityDialog.addEventListener('click', (event) => {
      const action = event.target.closest('[data-quantity-action]');
      if (action) {
        const value = quantityDialog.querySelector('[data-quantity-value]');
        value.textContent = String(Math.max(1, Number(value.textContent) + (action.dataset.quantityAction === 'increase' ? 1 : -1)));
      }
      if (event.target.closest('[data-confirm-quantity]')) {
        const id = Number(quantityDialog.dataset.productId);
        cart.set(id, { producto: catalog.productos.find((item) => item.idProducto === id), cantidad: Number(quantityDialog.querySelector('[data-quantity-value]').textContent) });
        quantityDialog.close();
        renderCart();
      }
    });
    root.querySelector('[data-checkout]').addEventListener('click', openCheckout);
    const checkoutDialog = root.querySelector('[data-checkout-dialog]');
    checkoutDialog.addEventListener('submit', submitOrder);
    checkoutDialog.querySelector('[data-find-customer]').addEventListener('click', () => identifyCustomer(checkoutDialog));
    checkoutDialog.querySelector('[name="phone"]').addEventListener('input', () => {
      checkoutDialog.dataset.checkedPhone = '';
      checkoutDialog.dataset.customerStatus = '';
      checkoutDialog.querySelector('[name="customerName"]').value = '';
      checkoutDialog.querySelector('[data-customer-name]').hidden = true;
      checkoutDialog.querySelector('[data-customer-confirmation]').hidden = true;
      checkoutDialog.querySelector('[data-customer-result]').textContent = 'Cuando termines, presiona “Buscar cliente”.';
    });
    checkoutDialog.querySelector('[data-close-checkout]').addEventListener('click', () => checkoutDialog.close());
    checkoutDialog.addEventListener('change', (event) => {
      if (event.target.name !== 'fulfillment') return;
      const delivery = event.target.value === 'entrega';
      root.querySelector('[data-delivery-fields]').hidden = !delivery;
      root.querySelector('[data-delivery-row]').hidden = !delivery;
      checkoutDialog.querySelector('[name="address"]').required = delivery;
    });
    root.querySelector('[data-open-cart]').addEventListener('click', () => root.querySelector('[data-cart-panel]').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    renderProducts();
    renderCart();
  }

  async function load() {
    slug = decodeURIComponent(globalThis.location.pathname.split('/').filter(Boolean).pop() || '');
    try {
      const response = await SecurityHttp.secureFetch(`/api/public/tiendas/${encodeURIComponent(slug)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw SecurityHttp.errorFromResponse(response, data, 'La tienda no está disponible.');
      catalog = data;
      restoreCartDraft();
      render();
    } catch (error) {
      const unavailable = Number(error?.status) === 404;
      root.innerHTML = `<section class="storefront-unavailable"><img src="/assets/administrau-icon.png" alt=""><p class="eyebrow">${unavailable ? 'TIENDA NO DISPONIBLE' : 'NO PUDIMOS ABRIR LA TIENDA'}</p><h1>${unavailable ? 'Este catálogo no está publicado' : 'Ocurrió un problema al cargar el catálogo'}</h1><p>${unavailable ? 'Puede estar en preparación o el enlace ya no está activo. Consulta con la tienda para recibir el enlace correcto.' : 'Intenta recargar la página en unos momentos. Si continúa, avisa a la tienda.'}</p></section>`;
    }
  }
  void load();
}());
