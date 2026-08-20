(function attachHelpCenter(global) {
  'use strict';

  const categories = [
    ['primeros-pasos', 'Primeros pasos'],
    ['ventas', 'Ventas'],
    ['inventario', 'Inventario'],
    ['clientes-credito', 'Clientes y credito'],
    ['reportes', 'Reportes'],
    ['configuracion', 'Configuracion'],
    ['mi-plan', 'Mi plan'],
    ['cuenta-acceso', 'Cuenta y acceso']
  ];

  const articles = [
    article('agregar-producto', 'Agregar un producto', 'primeros-pasos', 'producto catalogo inventario', 'Permite registrar lo que vendes y definir sus datos basicos.', ['Abre Productos.', 'Selecciona Agregar producto.', 'Completa los datos visibles y guarda los cambios.'], 'El producto queda disponible para organizar tu inventario.'),
    article('registrar-stock', 'Registrar stock', 'primeros-pasos', 'stock existencias compra inventario', 'Permite registrar existencias con una compra o un ajuste autorizado.', ['Abre Compras para registrar una entrada de mercaderia.', 'Indica proveedor, productos y cantidades.', 'Confirma el registro.'], 'El stock y sus movimientos quedan actualizados.'),
    article('primera-venta', 'Realizar la primera venta', 'primeros-pasos', 'venta punto de venta pos', 'Registra una venta desde el punto de venta.', ['Abre Punto de venta.', 'Busca y agrega los productos.', 'Revisa el cobro y selecciona Registrar venta.'], 'La venta, el comprobante y el movimiento de stock quedan registrados.'),
    article('reabrir-guia', 'Ver la guia de primeros pasos', 'primeros-pasos', 'guia welcome primeros pasos', 'Vuelve a mostrar la guia corta de producto, stock y primera venta.', ['Abre el boton Ver guia de primeros pasos.', 'Revisa el progreso actual.', 'Elige la siguiente tarea cuando tengas permiso para realizarla.'], 'La guia usa datos reales y no cambia tus registros por abrirla.'),
    article('realizar-venta', 'Realizar una venta', 'ventas', 'venta pos punto de venta cobro', 'El punto de venta permite buscar productos, revisar el carrito y registrar el cobro.', ['Abre Punto de venta.', 'Busca o escanea los productos y revisa la venta actual.', 'Elige la forma de cobro y registra la venta.'], 'Se genera el comprobante interno y el stock se actualiza.'),
    article('venta-contado', 'Venta al contado', 'ventas', 'contado efectivo qr pago venta', 'Una venta al contado se completa con una forma de cobro registrada.', ['Agrega los productos al carrito.', 'Mantiene Cliente opcional si la venta no necesita asociarse a una persona.', 'Elige la forma de cobro y registra la venta.'], 'La venta queda disponible en el historial.'),
    article('venta-credito', 'Venta a credito', 'ventas', 'fiado credito cliente venta saldo', 'Permite registrar una venta fiada para un cliente activo cuando sus condiciones lo permiten.', ['Busca y selecciona el cliente.', 'Elige Totalmente fiado como forma de cobro.', 'Revisa el resumen de credito antes de registrar la venta.'], 'La venta reduce stock y genera el saldo correspondiente.'),
    article('comprobante-historial', 'Comprobante e historial de ventas', 'ventas', 'comprobante historial venta detalle', 'El historial permite consultar ventas ya registradas y su detalle.', ['Abre Historial de ventas.', 'Usa los filtros disponibles si necesitas encontrar una venta.', 'Abre el detalle o comprobante cuando corresponda.'], 'La consulta no modifica la venta original.'),
    article('devoluciones-anulaciones', 'Devoluciones y anulaciones', 'ventas', 'devolucion anulacion compensacion venta', 'Permite registrar una correccion trazable para una venta cuando el flujo lo habilita.', ['Abre Devoluciones y anulaciones.', 'Busca la venta y revisa las opciones disponibles.', 'Confirma la accion despues de verificar su consecuencia.'], 'El sistema conserva la trazabilidad de la operacion original y su correccion.'),
    article('productos', 'Productos', 'inventario', 'productos catalogo precio stock', 'Productos es el punto principal para consultar y organizar tu catalogo.', ['Abre Productos.', 'Usa la busqueda y los filtros disponibles.', 'Selecciona Agregar producto o usa Mas opciones para acciones menos frecuentes.'], 'Los cambios permitidos se reflejan en el catalogo de tu tienda.'),
    article('compras', 'Registrar una compra', 'inventario', 'compra proveedor cantidades costos stock', 'Una compra registra la entrada de productos para actualizar existencias.', ['Abre Compras.', 'Selecciona el proveedor y agrega los productos.', 'Revisa cantidades y costos antes de confirmar.'], 'La compra deja trazabilidad y aumenta el stock segun la operacion registrada.'),
    article('proveedores', 'Proveedores', 'inventario', 'proveedor abastecimiento compra', 'Los proveedores ayudan a relacionar productos y compras con su origen.', ['Abre Proveedores.', 'Agrega o busca el proveedor.', 'Usa Mas opciones para acciones secundarias cuando aparezcan.'], 'El proveedor puede seleccionarse al registrar productos o compras.'),
    article('lotes', 'Lotes y vencimientos', 'inventario', 'lotes vencimientos fecha stock', 'Esta vista muestra la trazabilidad de lotes y sus estados cuando tu tienda los controla.', ['Abre Lotes y vencimientos.', 'Filtra por producto, proveedor o estado.', 'Revisa primero vencidos y proximos a vencer.'], 'La consulta ayuda a decidir que stock revisar sin cambiar las reglas de lotes.'),
    article('stock-movimientos', 'Stock y movimientos', 'inventario', 'stock movimientos entradas salidas historial', 'El stock actual y su historial se consultan en vistas distintas para evitar confusiones.', ['Abre Movimientos de stock.', 'Usa los filtros de producto o tipo cuando los necesites.', 'Revisa la referencia de cada entrada, salida o ajuste.'], 'El historial explica como cambio el stock; no lo modifica.'),
    article('ajustes', 'Ajustes de inventario', 'inventario', 'ajuste inventario motivo existencias', 'Un ajuste registra una correccion de existencias con su trazabilidad.', ['Abre Conciliacion de inventario.', 'Revisa el producto y el motivo del ajuste.', 'Selecciona Registrar ajuste y confirma los datos.'], 'El movimiento queda registrado para futuras consultas.'),
    article('inventario-inteligente', 'Inteligencia de inventario', 'inventario', 'alertas rotacion sugerencias inventario', 'Muestra alertas y consultas de apoyo para revisar abastecimiento.', ['Abre Inteligencia de inventario.', 'Usa Filtros para acotar el periodo o productos.', 'Revisa las alertas antes de tomar una decision operativa.'], 'Las sugerencias informan; no crean compras automaticamente.'),
    article('clientes', 'Crear y buscar clientes', 'clientes-credito', 'cliente buscar perfil telefono', 'Clientes permite registrar y consultar perfiles comerciales de tu tienda.', ['Abre Clientes.', 'Usa la busqueda y filtros para encontrar una persona.', 'Selecciona la accion disponible para crear o revisar su perfil.'], 'El cliente puede asociarse a una venta cuando corresponda.'),
    article('vender-fiado', 'Vender fiado', 'clientes-credito', 'fiado credito venta saldo cliente', 'El fiado se registra desde una venta asociada a un cliente.', ['Ve a Punto de venta.', 'Selecciona un cliente activo.', 'Revisa el credito disponible y elige Totalmente fiado si esta permitido.'], 'El saldo queda disponible para consulta y cobranza.'),
    article('consultar-saldo', 'Consultar saldo', 'clientes-credito', 'saldo deuda estado cuenta cliente', 'El perfil del cliente muestra su estado de cuenta y deuda vigente.', ['Abre Clientes y busca a la persona.', 'Abre su perfil.', 'Revisa el saldo y el historial disponible.'], 'La consulta no cambia la deuda.'),
    article('registrar-cobranza', 'Registrar una cobranza', 'clientes-credito', 'cobranza pago fiado deuda', 'Cobranza permite registrar pagos para una deuda existente.', ['Abre Cobranza.', 'Busca el cliente o deuda correspondiente.', 'Registra el monto y confirma la cobranza.'], 'El saldo y el historial se actualizan sin volver a afectar stock.'),
    article('inicio-reportes', 'Inicio y reportes', 'reportes', 'inicio resumen reportes ventas ganancias', 'Inicio muestra un resumen operativo; Reportes permite consultas mas especificas.', ['Usa Inicio para revisar ventas, alertas y prioridades.', 'Abre Reportes para elegir una consulta disponible.', 'Aplica los filtros necesarios antes de consultar.'], 'Los reportes muestran datos de tu tienda sin modificar operaciones.'),
    article('interpretar-reportes', 'Interpretar un reporte', 'reportes', 'interpretar reporte filtro periodo resultados', 'Un reporte ayuda a revisar una pregunta concreta del negocio.', ['Elige el tipo de reporte disponible.', 'Define periodo o filtros cuando correspondan.', 'Compara los resultados con el contexto de tu operacion diaria.'], 'Si no hay datos, ajusta filtros o revisa otro periodo.'),
    article('configuracion-tienda', 'Datos de la tienda', 'configuracion', 'configuracion tienda nombre telefono direccion', 'Configuracion reúne los datos operativos que identifican a tu tienda.', ['Abre Administracion y configuracion.', 'Selecciona Configuracion.', 'Edita los campos permitidos y usa Guardar cambios.'], 'Los datos se conservan para identificar tu tienda.'),
    article('moneda-zona-horaria', 'Moneda y zona horaria', 'configuracion', 'moneda bob zona horaria fecha', 'La configuracion muestra la moneda y zona horaria usadas por la tienda.', ['Abre Configuracion.', 'Revisa los valores visibles.', 'Guarda cambios solo si la cuenta permite editar.'], 'Estos datos ayudan a mostrar la operacion de forma coherente.'),
    article('datos-fiscales', 'Datos fiscales opcionales', 'configuracion', 'dato fiscal opcional facturacion', 'Puedes guardar un dato fiscal basico opcional dentro de Configuracion.', ['Abre Configuracion.', 'Ubica Informacion fiscal.', 'Completa el campo solo si corresponde y guarda los cambios.'], 'Esto no habilita facturacion fiscal.'),
    article('mi-plan', 'Plan actual y limites', 'mi-plan', 'mi plan limites suscripcion plan actual', 'Mi plan muestra el estado de suscripcion, limites y funcionalidades visibles.', ['Abre Mi plan.', 'Revisa el plan, estado y fecha relevante.', 'Consulta los limites antes de intentar una nueva alta.'], 'La pantalla muestra lo permitido sin cambiar tu plan por consultarla.'),
    article('cotizacion', 'Cotizar un pago', 'mi-plan', 'cotizacion pago precio bob usd plan', 'La cotizacion muestra el valor calculado para una operacion de suscripcion disponible.', ['Abre Mi plan.', 'Elige la operacion, periodo y metodo disponible.', 'Selecciona Cotizar antes de crear una solicitud.'], 'El importe mostrado se calcula por el sistema; no necesitas ingresarlo manualmente.'),
    article('solicitudes-pago', 'Solicitudes de pago manual', 'mi-plan', 'solicitud pago comprobante revision rechazada vencida', 'Las solicitudes permiten seguir un pago manual de suscripcion.', ['Crea una solicitud solo cuando la cotizacion este disponible.', 'Sigue las instrucciones del metodo seleccionado.', 'Adjunta o reemplaza el comprobante cuando el estado lo permita.'], 'El estado muestra si falta comprobante, esta en revision, fue observado, rechazado, aplicado, cancelado o vencio.'),
    article('solo-lectura-plan', 'Modo solo lectura y suscripcion', 'mi-plan', 'solo lectura gracia suspendida suscripcion', 'Algunos estados permiten consultar datos, pero bloquean cambios comerciales.', ['Abre Mi plan para revisar el estado.', 'Consulta las acciones de pago manual disponibles.', 'Cuando la cuenta vuelva a estar activa, retoma las tareas permitidas.'], 'Tus datos permanecen conservados mientras revisas el estado de la suscripcion.'),
    article('cerrar-sesion', 'Cerrar sesion', 'cuenta-acceso', 'cerrar sesion cuenta acceso', 'Cerrar sesion termina tu acceso desde el dispositivo actual.', ['Ubica Cerrar sesion en el menu de la tienda.', 'Confirma la accion si se solicita.', 'Vuelve a iniciar sesion cuando necesites continuar.'], 'La pantalla de acceso vuelve a estar disponible.'),
    article('acceso-permisos', 'Acceso y permisos', 'cuenta-acceso', 'permisos solo lectura acceso cuenta', 'Las acciones visibles dependen de tu acceso y del estado actual de la tienda.', ['Revisa los mensajes de solo lectura si aparecen.', 'Consulta Mi plan cuando el bloqueo se relacione con la suscripcion.', 'Usa solo las acciones habilitadas para tu cuenta.'], 'La ayuda no habilita acciones ni cambia permisos.')
  ];

  function article(id, title, category, keywords, what, steps, after) {
    return { id, title, category, keywords, what, steps, after };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  }

  function matches(item, query, category) {
    if (category && item.category !== category) return false;
    if (!query) return true;
    return normalize([item.title, item.category, item.keywords, item.what, item.steps.join(' '), item.after].join(' ')).includes(query);
  }

  function categoryLabel(id) {
    return categories.find(([key]) => key === id)?.[1] || 'Ayuda';
  }

  function renderArticle(item) {
    return `<details class="help-article" id="help-article-${escapeHtml(item.id)}" data-help-article="${escapeHtml(item.id)}">
      <summary><span>${escapeHtml(item.title)}</span><small>${escapeHtml(categoryLabel(item.category))}</small></summary>
      <div class="help-article-content">
        <section><h3>Que hace</h3><p>${escapeHtml(item.what)}</p></section>
        <section><h3>Como hacerlo</h3><ol>${item.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></section>
        <section><h3>Que pasa despues</h3><p>${escapeHtml(item.after)}</p></section>
      </div>
    </details>`;
  }

  function render({ root, topic = null, onBack = () => {}, onWelcome = () => {} } = {}) {
    if (!root) return;
    global.ProductAnalytics?.track('help_opened', { module: 'help', topic: topic || 'general' });
    let selectedCategory = '';
    let query = '';
    root.innerHTML = `
      <section class="help-center" aria-labelledby="helpCenterTitle">
        <header class="help-heading">
          <div><p class="eyebrow">Ayuda</p><h3 id="helpCenterTitle">Centro de ayuda</h3><p>Encuentra rapidamente como realizar las tareas mas comunes de tu tienda.</p></div>
          <button type="button" class="secondary" data-help-back>Volver</button>
        </header>
        <div class="help-search-row">
          <label for="helpSearch">Buscar en la ayuda</label>
          <div><input id="helpSearch" type="search" autocomplete="off" placeholder="Buscar en la ayuda"><button type="button" class="secondary" data-help-clear hidden>Limpiar busqueda</button></div>
        </div>
        <nav class="help-categories" aria-label="Categorias de ayuda">${categories.map(([id, label]) => `<button type="button" class="secondary" data-help-category="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</nav>
        <div class="help-welcome-callout"><div><strong>Primeros pasos</strong><span>Revisa tu guia corta de producto, stock y primera venta.</span></div><button type="button" class="secondary" data-help-welcome>Ver guia de primeros pasos</button></div>
        <p class="help-result-status" data-help-results role="status" aria-live="polite"></p>
        <div class="help-article-list" data-help-list></div>
      </section>`;
    const input = root.querySelector('#helpSearch');
    const list = root.querySelector('[data-help-list]');
    const status = root.querySelector('[data-help-results]');
    const clear = root.querySelector('[data-help-clear]');

    const update = ({ focusTopic = null } = {}) => {
      const rows = articles.filter((item) => matches(item, query, selectedCategory));
      clear.hidden = !query;
      root.querySelectorAll('[data-help-category]').forEach((button) => {
        const active = button.dataset.helpCategory === selectedCategory;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      status.textContent = rows.length
        ? `${rows.length} ${rows.length === 1 ? 'tema encontrado' : 'temas encontrados'}.`
        : 'No encontramos ayuda con esos terminos. Prueba otra palabra o limpia la busqueda.';
      list.innerHTML = rows.length
        ? rows.map(renderArticle).join('')
        : '<section class="help-empty" role="status"><strong>Sin resultados</strong><p>Prueba con otra palabra o revisa una categoria.</p></section>';
      if (focusTopic) {
        const target = root.querySelector(`[data-help-article="${focusTopic}"]`);
        if (target) {
          target.open = true;
          global.requestAnimationFrame(() => {
            target.querySelector('summary')?.focus();
            target.scrollIntoView({ block: 'start' });
          });
        }
      }
    };

    root.querySelector('[data-help-back]')?.addEventListener('click', onBack);
    root.querySelector('[data-help-welcome]')?.addEventListener('click', onWelcome);
    input.addEventListener('input', () => { query = normalize(input.value); selectedCategory = ''; update(); });
    clear.addEventListener('click', () => { input.value = ''; query = ''; update(); input.focus(); });
    root.querySelectorAll('[data-help-category]').forEach((button) => button.addEventListener('click', () => {
      selectedCategory = selectedCategory === button.dataset.helpCategory ? '' : button.dataset.helpCategory;
      update();
    }));
    update({ focusTopic: topic && articles.some((item) => item.id === topic) ? topic : null });
  }

  global.HelpCenter = Object.freeze({ render, articles: Object.freeze(articles.map((item) => Object.freeze({ ...item }))) });
}(window));
