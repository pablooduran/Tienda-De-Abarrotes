const pool = require('../config/db');
const { resolveSubscriptionAccess } = require('./subscription-access-service');
const { formatLocalDateTime } = require('../utils/local-datetime');
const { AppError } = require('../utils/app-error');

function positiveId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(400, `${label} no es valido.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return parsed;
}

function cleanText(value, maximum, label, { nullable = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text && nullable) return null;
  if (!text || text.length > maximum) {
    throw new AppError(400, `${label} debe tener entre 1 y ${maximum} caracteres.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return text;
}

function booleanValue(value, label) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw new AppError(400, `${label} no es valido.`, 'ONLINE_STORE_INPUT_INVALID');
}

function decimalValue(value, label, maximum = 999999.99) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) {
    throw new AppError(400, `${label} no es valido.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return Math.round(parsed * 100) / 100;
}

function integerValue(value, label, minimum, maximum, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AppError(400, `${label} debe estar entre ${minimum} y ${maximum}.`, 'ONLINE_STORE_INPUT_INVALID');
  }
  return parsed;
}

function publicConfiguration(row) {
  return {
    activa: Boolean(row.activa),
    mensajeBienvenida: row.mensajeBienvenida || '',
    permiteRecojo: Boolean(row.permiteRecojo),
    permiteEntrega: Boolean(row.permiteEntrega),
    permiteEfectivo: Boolean(row.permiteEfectivo),
    permiteQr: Boolean(row.permiteQr),
    pedidoMinimo: Number(row.pedidoMinimo || 0),
    costoEntrega: Number(row.costoEntrega || 0),
    tiempoPreparacionMinutos: Number(row.tiempoPreparacionMinutos || 30)
  };
}

function ownerProduct(row) {
  return {
    idProducto: Number(row.idProducto),
    nombre: row.nombre,
    categoria: row.categoria,
    unidadMedida: row.unidadMedida,
    precioVenta: Number(row.precioVenta),
    stockUnidadesTotal: Number(row.stockUnidadesTotal),
    stockMinimo: Number(row.stockMinimo),
    publicado: Boolean(row.publicado),
    destacado: Boolean(row.destacado),
    descripcionPublica: row.descripcionPublica || '',
    cantidadMaximaPedido: row.cantidadMaximaPedido === null ? null : Number(row.cantidadMaximaPedido),
    permiteSustitucion: Boolean(row.permiteSustitucion)
  };
}

function availabilityFor(row) {
  const stock = Number(row.stockUnidadesTotal);
  if (stock <= 0) return 'agotado';
  if (stock <= Number(row.stockMinimo)) return 'pocas_unidades';
  return 'disponible';
}

function publicProduct(row) {
  return {
    idProducto: Number(row.idProducto),
    nombre: row.nombre,
    categoria: row.categoria,
    unidadMedida: row.unidadMedida,
    precioVenta: Number(row.precioVenta),
    destacado: Boolean(row.destacado),
    descripcion: row.descripcionPublica || '',
    cantidadMaximaPedido: row.cantidadMaximaPedido === null ? null : Number(row.cantidadMaximaPedido),
    disponibilidad: availabilityFor(row)
  };
}

function createOnlineStoreService({
  database = pool,
  subscriptionResolver = resolveSubscriptionAccess,
  clock = () => formatLocalDateTime()
} = {}) {
  async function getConfiguration(idTienda) {
    const storeId = positiveId(idTienda, 'La tienda');
    const [rows] = await database.query(
      `SELECT t.slug,c.*
       FROM tienda t
       JOIN configuracionTiendaOnline c ON c.idTienda=t.idTienda
       WHERE t.idTienda=? LIMIT 1`,
      [storeId]
    );
    if (!rows[0]) throw new AppError(404, 'La configuracion de la tienda online no esta disponible.', 'ONLINE_STORE_NOT_FOUND');
    return { enlacePublico: `/tienda/${rows[0].slug}`, configuracion: publicConfiguration(rows[0]) };
  }

  async function updateConfiguration(context, body = {}) {
    const idTienda = positiveId(context?.idTienda, 'La tienda');
    const idAdministrador = positiveId(context?.idAdministrador, 'El administrador');
    const patch = {
      activa: booleanValue(body.activa, 'El estado de la tienda online'),
      mensajeBienvenida: cleanText(body.mensajeBienvenida, 300, 'El mensaje de bienvenida'),
      permiteRecojo: booleanValue(body.permiteRecojo, 'La opcion de recojo'),
      permiteEntrega: booleanValue(body.permiteEntrega, 'La opcion de entrega'),
      permiteEfectivo: booleanValue(body.permiteEfectivo, 'La opcion de efectivo'),
      permiteQr: booleanValue(body.permiteQr, 'La opcion de QR'),
      pedidoMinimo: decimalValue(body.pedidoMinimo, 'El pedido minimo'),
      costoEntrega: decimalValue(body.costoEntrega, 'El costo de entrega'),
      tiempoPreparacionMinutos: integerValue(body.tiempoPreparacionMinutos, 'El tiempo de preparacion', 5, 1440)
    };
    if (!patch.permiteRecojo && !patch.permiteEntrega) {
      throw new AppError(400, 'Habilita recojo o entrega para recibir pedidos.', 'ONLINE_STORE_DELIVERY_REQUIRED');
    }
    if (!patch.permiteEfectivo && !patch.permiteQr) {
      throw new AppError(400, 'Habilita efectivo o QR como forma de pago.', 'ONLINE_STORE_PAYMENT_REQUIRED');
    }
    await database.query(
      `UPDATE configuracionTiendaOnline
       SET activa=?,mensajeBienvenida=?,permiteRecojo=?,permiteEntrega=?,permiteEfectivo=?,permiteQr=?,
           pedidoMinimo=?,costoEntrega=?,tiempoPreparacionMinutos=?,actualizadoEn=?,idAdministradorActualiza=?
       WHERE idTienda=?`,
      [patch.activa, patch.mensajeBienvenida, patch.permiteRecojo, patch.permiteEntrega,
        patch.permiteEfectivo, patch.permiteQr, patch.pedidoMinimo, patch.costoEntrega,
        patch.tiempoPreparacionMinutos, clock(), idAdministrador, idTienda]
    );
    return getConfiguration(idTienda);
  }

  async function listProducts(idTienda) {
    const storeId = positiveId(idTienda, 'La tienda');
    const [rows] = await database.query(
      `SELECT p.idProducto,p.nombre,p.categoria,p.unidadMedida,p.precioVenta,
              p.stockUnidadesTotal,p.stockMinimo,
              COALESCE(o.publicado,0) publicado,COALESCE(o.destacado,0) destacado,
              o.descripcionPublica,o.cantidadMaximaPedido,COALESCE(o.permiteSustitucion,0) permiteSustitucion
       FROM producto p
       LEFT JOIN productoCatalogoOnline o ON o.idTienda=p.idTienda AND o.idProducto=p.idProducto
       WHERE p.idTienda=? AND p.activo=1
       ORDER BY COALESCE(o.destacado,0) DESC,p.nombre`,
      [storeId]
    );
    return { productos: rows.map(ownerProduct) };
  }

  async function updateProduct(context, idProducto, body = {}) {
    const idTienda = positiveId(context?.idTienda, 'La tienda');
    const idAdministrador = positiveId(context?.idAdministrador, 'El administrador');
    const productId = positiveId(idProducto, 'El producto');
    const published = booleanValue(body.publicado, 'La publicacion');
    const featured = published ? booleanValue(body.destacado, 'El destacado') : 0;
    const description = cleanText(body.descripcionPublica, 300, 'La descripcion publica');
    const maxQuantity = integerValue(body.cantidadMaximaPedido, 'La cantidad maxima', 1, 10000, { nullable: true });
    const substitution = published ? booleanValue(body.permiteSustitucion, 'La sustitucion') : 0;
    const [products] = await database.query(
      'SELECT idProducto FROM producto WHERE idTienda=? AND idProducto=? AND activo=1 LIMIT 1',
      [idTienda, productId]
    );
    if (!products[0]) throw new AppError(404, 'El producto no pertenece a esta tienda o ya no esta activo.', 'ONLINE_STORE_PRODUCT_NOT_FOUND');
    const now = clock();
    await database.query(
      `INSERT INTO productoCatalogoOnline
       (idTienda,idProducto,publicado,destacado,descripcionPublica,cantidadMaximaPedido,
        permiteSustitucion,creadoEn,actualizadoEn,idAdministradorActualiza)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE publicado=VALUES(publicado),destacado=VALUES(destacado),
         descripcionPublica=VALUES(descripcionPublica),cantidadMaximaPedido=VALUES(cantidadMaximaPedido),
         permiteSustitucion=VALUES(permiteSustitucion),actualizadoEn=VALUES(actualizadoEn),
         idAdministradorActualiza=VALUES(idAdministradorActualiza)`,
      [idTienda, productId, published, featured, description, maxQuantity, substitution, now, now, idAdministrador]
    );
    const data = await listProducts(idTienda);
    return { producto: data.productos.find((product) => product.idProducto === productId) };
  }

  async function getPublicCatalog(slugValue) {
    const slug = String(slugValue || '').trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
      throw new AppError(404, 'La tienda no esta disponible.', 'PUBLIC_STORE_NOT_FOUND');
    }
    const [stores] = await database.query(
      `SELECT t.idTienda,t.slug,t.nombre,c.nombreMostrado,
              o.activa,o.mensajeBienvenida,o.permiteRecojo,o.permiteEntrega,
              o.permiteEfectivo,o.permiteQr,o.pedidoMinimo,o.costoEntrega,o.tiempoPreparacionMinutos
       FROM tienda t
       JOIN configuracionTienda c ON c.idTienda=t.idTienda
       JOIN configuracionTiendaOnline o ON o.idTienda=t.idTienda
       WHERE t.slug=? AND t.activo=1 AND t.estado='activa' LIMIT 1`,
      [slug]
    );
    const store = stores[0];
    if (!store || !Number(store.activa)) {
      throw new AppError(404, 'La tienda no esta disponible.', 'PUBLIC_STORE_NOT_FOUND');
    }
    const subscription = await subscriptionResolver(database, Number(store.idTienda), { materialize: false });
    if (subscription.estadoAcceso !== 'completo' || !subscription.caracteristicas?.includes('portal_clientes')) {
      throw new AppError(404, 'La tienda no esta disponible.', 'PUBLIC_STORE_NOT_FOUND');
    }
    const [rows] = await database.query(
      `SELECT p.idProducto,p.nombre,p.categoria,p.unidadMedida,p.precioVenta,
              p.stockUnidadesTotal,p.stockMinimo,o.destacado,o.descripcionPublica,o.cantidadMaximaPedido
       FROM productoCatalogoOnline o
       JOIN producto p ON p.idTienda=o.idTienda AND p.idProducto=o.idProducto
       WHERE o.idTienda=? AND o.publicado=1 AND p.activo=1
       ORDER BY o.destacado DESC,p.nombre`,
      [store.idTienda]
    );
    return {
      tienda: {
        nombre: store.nombreMostrado || store.nombre,
        slug: store.slug,
        mensajeBienvenida: store.mensajeBienvenida || '',
        opciones: {
          recojo: Boolean(store.permiteRecojo),
          entrega: Boolean(store.permiteEntrega),
          efectivo: Boolean(store.permiteEfectivo),
          qr: Boolean(store.permiteQr)
        },
        pedidoMinimo: Number(store.pedidoMinimo || 0),
        costoEntrega: Number(store.costoEntrega || 0),
        tiempoPreparacionMinutos: Number(store.tiempoPreparacionMinutos || 30)
      },
      categorias: [...new Set(rows.map((row) => row.categoria))].sort((a, b) => a.localeCompare(b, 'es')),
      productos: rows.map(publicProduct)
    };
  }

  return Object.freeze({ getConfiguration, updateConfiguration, listProducts, updateProduct, getPublicCatalog });
}

const onlineStoreService = createOnlineStoreService();
module.exports = { createOnlineStoreService, onlineStoreService, publicConfiguration, publicProduct };
