const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { enforcePlanLimit } = require('../services/subscription-service');
const {
  insertStockMovement,
  movementKey,
  operationKey
} = require('../services/stock-movement-service');

const router = express.Router();

function omitTenant(value) {
  if (Array.isArray(value)) return value.map(omitTenant);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'idTienda')
      .map(([key, item]) => [key, omitTenant(item)])
  );
}

router.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(omitTenant(body));
  next();
});

router.get('/contexto', (req, res) => {
  const context = req.subscriptionContext;
  res.json({
    usuario: req.session.admin.usuario,
    rol: req.session.admin.rol,
    tienda: context.tienda,
    plan: context.plan ? { codigo: context.plan.codigo, nombre: context.plan.nombre } : null,
    suscripcion: context.suscripcion,
    soloLectura: context.soloLectura,
    caracteristicas: context.caracteristicas,
    limites: context.limites,
    uso: context.uso
  });
});

const units = ['unidad', 'paquete', 'kilo', 'gramo', 'litro', 'mililitro', 'caja', 'docena', 'bolsa'];
const categories = ['LACTEOS', 'LIMPIEZA', 'BEBIDAS', 'SNACKS', 'ABARROTES', 'ASEO PERSONAL', 'CONDIMENTOS', 'OTROS'];
const purchasePresentations = ['caja', 'paquete', 'unidad'];
const salePresentations = ['paquete', 'unidad'];

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanText(value) {
  return String(value || '').trim();
}

function nullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asPositiveInteger(value, field, allowZero = false) {
  const number = Number(value);
  const valid = Number.isInteger(number) && (allowZero ? number >= 0 : number > 0);
  if (!valid) {
    const error = new Error(`${field} debe ser un numero entero ${allowZero ? 'igual o mayor a cero' : 'positivo'}.`);
    error.status = 400;
    throw error;
  }
  return number;
}

function validatePhone(value, field = 'Telefono') {
  if (value === undefined || value === null || value === '') return null;
  const phone = String(value).trim();
  if (!/^\d+$/.test(phone)) {
    const error = new Error(`${field} solo debe contener numeros.`);
    error.status = 400;
    throw error;
  }
  return phone;
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length) {
    const error = new Error(`Campos obligatorios: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
}

function adminPasswordFromBody(body) {
  return body.passwordAdministrador || body.adminPassword || body.contrasena || body.password || '';
}

function tenantId(req) {
  return req.tenant.idTienda;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function lockTenantForLimit(connection, idTienda) {
  const [rows] = await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [idTienda]);
  if (!rows.length) throw notFound('Tienda no encontrada.');
}

async function requireTenantRecord(connection, table, idField, id, idTienda, extraWhere = '') {
  if (!id) return null;
  const [rows] = await connection.query(
    `SELECT ${idField} FROM ${table} WHERE ${idField}=? AND idTienda=? ${extraWhere} LIMIT 1`,
    [id, idTienda]
  );
  if (!rows.length) throw notFound('Registro relacionado no encontrado.');
  return rows[0];
}

async function requireAdminPassword(req) {
  const password = adminPasswordFromBody(req.body || {});
  if (!password) {
    const error = new Error('Debes ingresar la contraseña del administrador.');
    error.status = 400;
    throw error;
  }
  const adminId = req.session?.admin?.id;
  if (!adminId) {
    const error = new Error('Sesión no válida. Inicia sesión nuevamente.');
    error.status = 401;
    throw error;
  }
  const [rows] = await pool.query(
    `SELECT password FROM administrador
     WHERE idAdministrador=? AND idTienda=? AND rol='dueno_tienda' AND activo=1`,
    [adminId, tenantId(req)]
  );
  if (!rows.length || !await bcrypt.compare(password, rows[0].password)) {
    const error = new Error('Contraseña de administrador incorrecta.');
    error.status = 403;
    throw error;
  }
}

async function runTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function productSelect(where = '') {
  return `
    SELECT p.*, pr.nombre AS proveedor,
      p.stockUnidadesTotal < p.stockMinimo AS bajoStock
    FROM producto p
    LEFT JOIN proveedor pr ON pr.idProveedor = p.idProveedor AND pr.idTienda=p.idTienda
    ${where}
  `;
}

function equivalentUnits(product, cantidad, presentation, isPurchase) {
  if (isPurchase && presentation === 'caja') return cantidad * product.paquetesPorCaja * product.unidadesPorPaquete;
  if (presentation === 'paquete') return cantidad * product.unidadesPorPaquete;
  return cantidad;
}

function validateProductPayload(body, editing = false) {
  requireFields(body, ['nombre', 'unidadMedida', 'precioVenta', 'categoria', 'unidadesPorPaquete', 'paquetesPorCaja', 'stockMinimo']);
  const categoria = upper(body.categoria || 'OTROS');
  if (!units.includes(body.unidadMedida)) {
    const error = new Error('Unidad de medida invalida.');
    error.status = 400;
    throw error;
  }
  if (!categories.includes(categoria)) {
    const error = new Error('Categoria invalida.');
    error.status = 400;
    throw error;
  }
  const unidadesPorPaquete = asPositiveInteger(Number(body.unidadesPorPaquete), 'Unidades por paquete');
  const paquetesPorCaja = asPositiveInteger(Number(body.paquetesPorCaja), 'Paquetes por caja');
  const permiteVentaPorPaquete = Boolean(body.permiteVentaPorPaquete === true || body.permiteVentaPorPaquete === 'true' || body.permiteVentaPorPaquete === 'on' || body.permiteVentaPorPaquete === '1');
  const permiteVentaPorUnidad = !(body.permiteVentaPorUnidad === false || body.permiteVentaPorUnidad === 'false' || body.permiteVentaPorUnidad === '0');
  if (permiteVentaPorPaquete && unidadesPorPaquete <= 1) {
    const error = new Error('Para vender por paquete, unidades por paquete debe ser mayor a 1.');
    error.status = 400;
    throw error;
  }
  if (!permiteVentaPorPaquete && !permiteVentaPorUnidad) {
    const error = new Error('El producto debe permitir venta por paquete o por unidad.');
    error.status = 400;
    throw error;
  }
  const stockUnidadesTotal = editing
    ? null
    : asPositiveInteger(Number(body.stockUnidadesTotal ?? body.stock ?? 0), 'Stock total', true);
  return {
    nombre: cleanText(body.nombre),
    idProveedor: body.idProveedor || null,
    categoria,
    unidadMedida: body.unidadMedida,
    unidadesPorPaquete,
    paquetesPorCaja,
    precioVenta: asNumber(body.precioVenta),
    stockUnidadesTotal,
    stockMinimo: asPositiveInteger(Number(body.stockMinimo), 'Stock minimo'),
    ultimoPrecioCompra: editing ? null : asNumber(body.ultimoPrecioCompra || 0),
    permiteVentaPorPaquete,
    permiteVentaPorUnidad
  };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const idTienda = tenantId(req);
    const [[ventasHoy], [ventasAyer], [ventasMes], [ventasMesPasado], [ventasSemana], [ventasSemanaPasada], [gananciaHoy], [gananciaMes], [bajoStock], [fiadosEstado], [ventasDias]] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE idTienda=? AND DATE(fecha) = CURDATE()', [idTienda]),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE idTienda=? AND DATE(fecha) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)', [idTienda]),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE idTienda=? AND YEAR(fecha)=YEAR(CURDATE()) AND MONTH(fecha)=MONTH(CURDATE())', [idTienda]),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE idTienda=? AND YEAR(fecha)=YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND MONTH(fecha)=MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))', [idTienda]),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE idTienda=? AND YEARWEEK(fecha, 1) = YEARWEEK(CURDATE(), 1)', [idTienda]),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE idTienda=? AND YEARWEEK(fecha, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 1 WEEK), 1)', [idTienda]),
      pool.query('SELECT COALESCE(SUM(d.ganancia), 0) total FROM detalleVenta d JOIN venta v ON v.idVenta=d.idVenta AND v.idTienda=d.idTienda WHERE d.idTienda=? AND DATE(v.fecha)=CURDATE()', [idTienda]),
      pool.query('SELECT COALESCE(SUM(d.ganancia), 0) total FROM detalleVenta d JOIN venta v ON v.idVenta=d.idVenta AND v.idTienda=d.idTienda WHERE d.idTienda=? AND YEAR(v.fecha)=YEAR(CURDATE()) AND MONTH(v.fecha)=MONTH(CURDATE())', [idTienda]),
      pool.query('SELECT COUNT(*) total FROM producto WHERE idTienda=? AND activo=1 AND stockUnidadesTotal < stockMinimo', [idTienda]),
      pool.query('SELECT estado, COUNT(*) total FROM fiado WHERE idTienda=? GROUP BY estado', [idTienda]),
      pool.query('SELECT DATE(fecha) dia, COALESCE(SUM(total),0) total FROM venta WHERE idTienda=? AND fecha >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(fecha) ORDER BY dia', [idTienda])
    ]);
    const estados = { pendiente: 0, parcial: 0, pagado: 0 };
    fiadosEstado.forEach((row) => { estados[row.estado] = row.total; });
    res.json({
      ventasHoy: ventasHoy[0].total,
      ventasAyer: ventasAyer[0].total,
      ventasMes: ventasMes[0].total,
      ventasMesPasado: ventasMesPasado[0].total,
      ventasSemana: ventasSemana[0].total,
      ventasSemanaPasada: ventasSemanaPasada[0].total,
      gananciaHoy: gananciaHoy[0].total,
      gananciaMes: gananciaMes[0].total,
      bajoStock: bajoStock[0].total,
      fiados: estados,
      chartVentasDias: ventasDias
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get('/categorias', (req, res) => {
  res.json(categories);
});

router.get('/productos', async (req, res, next) => {
  try {
    const { q, idProveedor, categoria, bajoStock, sort } = req.query;
    const conditions = ['p.idTienda=?', 'p.activo=1'];
    const params = [tenantId(req)];
    if (q) {
      conditions.push('UPPER(p.nombre) LIKE ?');
      params.push(`%${upper(q)}%`);
    }
    if (idProveedor) {
      conditions.push('p.idProveedor = ?');
      params.push(idProveedor);
    }
    if (categoria) {
      conditions.push('p.categoria = ?');
      params.push(upper(categoria));
    }
    if (bajoStock === 'true') conditions.push('p.stockUnidadesTotal < p.stockMinimo');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = sort === 'precio_desc' ? 'p.precioVenta DESC' : sort === 'precio_asc' ? 'p.precioVenta ASC' : 'p.nombre';
    const [rows] = await pool.query(`${productSelect(where)} ORDER BY ${order} LIMIT 200`, params);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/productos', async (req, res, next) => {
  let connection;
  try {
    const data = validateProductPayload(req.body);
    const idTienda = tenantId(req);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await lockTenantForLimit(connection, idTienda);
    await enforcePlanLimit(connection, idTienda, 'productos');
    if (data.idProveedor) {
      await requireTenantRecord(connection, 'proveedor', 'idProveedor', data.idProveedor, idTienda);
    }
    const [result] = await connection.query(
      `INSERT INTO producto
       (idTienda, nombre, idProveedor, categoria, unidadMedida, unidadesPorPaquete, paquetesPorCaja, precioVenta, stock, stockMinimo, stockUnidadesTotal, ultimoPrecioCompra, permiteVentaPorPaquete, permiteVentaPorUnidad)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [idTienda, data.nombre, data.idProveedor, data.categoria, data.unidadMedida, data.unidadesPorPaquete, data.paquetesPorCaja, data.precioVenta, data.stockUnidadesTotal, data.stockMinimo, data.stockUnidadesTotal, data.ultimoPrecioCompra, data.permiteVentaPorPaquete, data.permiteVentaPorUnidad]
    );
    if (data.stockUnidadesTotal > 0) {
      await insertStockMovement(connection, {
        idTienda,
        idProducto: result.insertId,
        tipoMovimiento: 'inventario_inicial',
        origen: 'alta_producto',
        cantidad: data.stockUnidadesTotal,
        stockAnterior: 0,
        stockPosterior: data.stockUnidadesTotal,
        cantidadOperacion: data.stockUnidadesTotal,
        unidadOperacion: 'unidad_base',
        motivo: 'Stock inicial al crear el producto.',
        referenciaTipo: 'producto',
        referenciaId: result.insertId,
        claveOperacion: movementKey('alta-producto', result.insertId),
        idAdministrador: req.session.admin.id
      });
    }
    await connection.commit();
    res.status(201).json({ message: 'Producto guardado.', idProducto: result.insertId });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

router.put('/productos/:id', async (req, res, next) => {
  try {
    const data = validateProductPayload(req.body, true);
    const idTienda = tenantId(req);
    if (data.idProveedor) {
      await requireTenantRecord(pool, 'proveedor', 'idProveedor', data.idProveedor, idTienda);
    }
    const [result] = await pool.query(
      `UPDATE producto
       SET nombre=?, idProveedor=?, categoria=?, unidadMedida=?, unidadesPorPaquete=?, paquetesPorCaja=?,
           precioVenta=?, stockMinimo=?, permiteVentaPorPaquete=?, permiteVentaPorUnidad=?
       WHERE idProducto=? AND idTienda=? AND activo=1`,
      [data.nombre, data.idProveedor, data.categoria, data.unidadMedida, data.unidadesPorPaquete,
        data.paquetesPorCaja, data.precioVenta, data.stockMinimo, data.permiteVentaPorPaquete,
        data.permiteVentaPorUnidad, req.params.id, idTienda]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json({ message: 'Producto actualizado.' });
  } catch (error) {
    next(error);
  }
});

router.get('/productos/ocultos', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `${productSelect('WHERE p.idTienda=? AND p.activo=0')} ORDER BY p.eliminadoEn DESC, p.nombre`,
      [tenantId(req)]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.patch('/productos/:id/restaurar', async (req, res, next) => {
  try {
    const idTienda = tenantId(req);
    await runTransaction(async (connection) => {
      await lockTenantForLimit(connection, idTienda);
      const [rows] = await connection.query(
        'SELECT idProducto FROM producto WHERE idProducto=? AND idTienda=? AND activo=0 FOR UPDATE',
        [req.params.id, idTienda]
      );
      if (!rows.length) throw notFound('Producto oculto no encontrado.');
      await enforcePlanLimit(connection, idTienda, 'productos');
      await connection.query(
        'UPDATE producto SET activo=1, eliminadoEn=NULL WHERE idProducto=? AND idTienda=? AND activo=0',
        [req.params.id, idTienda]
      );
    });
    res.json({ message: 'Producto restaurado. Su stock no fue modificado.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/productos/:id', async (req, res, next) => {
  try {
    const [result] = await pool.query(
      'UPDATE producto SET activo=0, eliminadoEn=NOW() WHERE idProducto=? AND idTienda=? AND activo=1',
      [req.params.id, tenantId(req)]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json({ message: 'Producto ocultado. Su stock e historial se conservaron.' });
  } catch (error) {
    next(error);
  }
});

function crudRoutes(base, table, idField, protectedDeleteMessage) {
  router.get(`/${base}`, async (req, res, next) => {
    try {
      const active = table === 'cliente' ? 'AND activo=1' : '';
      const [rows] = await pool.query(
        `SELECT * FROM ${table} WHERE idTienda=? ${active} ORDER BY nombre`,
        [tenantId(req)]
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${base}`, async (req, res, next) => {
    let connection;
    try {
      requireFields(req.body, ['nombre']);
      const nombre = cleanText(req.body.nombre);
      const telefono = validatePhone(req.body.telefono);
      const idTienda = tenantId(req);
      connection = await pool.getConnection();
      await connection.beginTransaction();
      await lockTenantForLimit(connection, idTienda);
      await enforcePlanLimit(connection, idTienda, table === 'proveedor' ? 'proveedores' : 'clientes');
      if (table === 'proveedor') {
        await connection.query(
          'INSERT INTO proveedor (idTienda, nombre, telefono, direccion) VALUES (?, ?, ?, ?)',
          [idTienda, nombre, telefono, nullableText(req.body.direccion)]
        );
      } else {
        await connection.query('INSERT INTO cliente (idTienda, nombre, telefono) VALUES (?, ?, ?)', [idTienda, nombre, telefono]);
      }
      await connection.commit();
      res.status(201).json({ message: 'Registro guardado.' });
    } catch (error) {
      if (connection) await connection.rollback();
      next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.put(`/${base}/:id`, async (req, res, next) => {
    try {
      requireFields(req.body, ['nombre']);
      const nombre = cleanText(req.body.nombre);
      const telefono = validatePhone(req.body.telefono);
      const idTienda = tenantId(req);
      let result;
      if (table === 'proveedor') {
        [result] = await pool.query(
          'UPDATE proveedor SET nombre=?, telefono=?, direccion=? WHERE idProveedor=? AND idTienda=?',
          [nombre, telefono, nullableText(req.body.direccion), req.params.id, idTienda]
        );
      } else {
        [result] = await pool.query(
          'UPDATE cliente SET nombre=?, telefono=? WHERE idCliente=? AND idTienda=?',
          [nombre, telefono, req.params.id, idTienda]
        );
      }
      if (!result.affectedRows) return res.status(404).json({ error: 'Registro no encontrado.' });
      res.json({ message: 'Registro actualizado.' });
    } catch (error) {
      next(error);
    }
  });

  router.delete(`/${base}/:id`, async (req, res, next) => {
    try {
      if (table === 'cliente') {
        await requireAdminPassword(req);
        const [result] = await pool.query(
          'UPDATE cliente SET activo=0, eliminadoEn=NOW() WHERE idCliente=? AND idTienda=? AND activo=1',
          [req.params.id, tenantId(req)]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Cliente no encontrado o ya está oculto.' });
        return res.json({ message: 'Cliente ocultado. El historial se conserva.' });
      }
      const [result] = await pool.query(
        `DELETE FROM ${table} WHERE ${idField}=? AND idTienda=?`,
        [req.params.id, tenantId(req)]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Registro no encontrado.' });
      res.json({ message: 'Registro eliminado.' });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: protectedDeleteMessage });
      next(error);
    }
  });
}

router.get('/clientes/ocultos', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM cliente WHERE idTienda=? AND activo=0 ORDER BY eliminadoEn DESC, nombre',
      [tenantId(req)]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.patch('/clientes/:id/restaurar', async (req, res, next) => {
  let connection;
  try {
    await requireAdminPassword(req);
    const idTienda = tenantId(req);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await lockTenantForLimit(connection, idTienda);
    const [hidden] = await connection.query(
      'SELECT idCliente FROM cliente WHERE idCliente=? AND idTienda=? AND activo=0 FOR UPDATE',
      [req.params.id, idTienda]
    );
    if (!hidden.length) throw notFound('Cliente oculto no encontrado.');
    await enforcePlanLimit(connection, idTienda, 'clientes');
    const [result] = await connection.query(
      'UPDATE cliente SET activo=1, eliminadoEn=NULL WHERE idCliente=? AND idTienda=? AND activo=0',
      [req.params.id, idTienda]
    );
    if (!result.affectedRows) throw notFound('Cliente oculto no encontrado.');
    await connection.commit();
    res.json({ message: 'Cliente restaurado.' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

crudRoutes('clientes', 'cliente', 'idCliente', 'No se puede eliminar el cliente porque tiene ventas o fiados asociados.');
crudRoutes('proveedores', 'proveedor', 'idProveedor', 'No se puede eliminar el proveedor porque tiene compras o productos asociados.');

async function validateItems(connection, items, type, idTienda) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('Debe agregar al menos un producto.');
    error.status = 400;
    throw error;
  }
  const isPurchase = type === 'compra';
  const prepared = items.map((item, originalIndex) => {
    const cantidad = asPositiveInteger(Number(item.cantidad), 'Cantidad');
    const idProducto = asPositiveInteger(Number(item.idProducto), 'Producto');
    const presentation = item.presentacion || item.modoCompra || 'unidad';
    const validPresentations = isPurchase ? purchasePresentations : salePresentations;
    if (!validPresentations.includes(presentation)) {
      const error = new Error(isPurchase ? 'Presentacion de compra invalida.' : 'Presentacion de venta invalida.');
      error.status = 400;
      throw error;
    }
    return { item, originalIndex, cantidad, idProducto, presentation };
  });
  if (new Set(prepared.map((entry) => entry.idProducto)).size !== prepared.length) {
    const error = new Error('Cada producto debe aparecer una sola vez en la operacion.');
    error.status = 400;
    throw error;
  }

  const normalized = [];
  for (const entry of [...prepared].sort((a, b) => a.idProducto - b.idProducto)) {
    const { item, originalIndex, cantidad, idProducto, presentation } = entry;
    const [rows] = await connection.query(
      `${productSelect('WHERE p.idProducto=? AND p.idTienda=? AND p.activo=1')} FOR UPDATE`,
      [idProducto, idTienda]
    );
    if (rows.length === 0) {
      const error = new Error('Producto no encontrado.');
      error.status = 404;
      throw error;
    }
    const product = rows[0];
    if (!isPurchase && presentation === 'paquete' && !product.permiteVentaPorPaquete) {
      const error = new Error(`${product.nombre} no permite venta por paquete.`);
      error.status = 400;
      throw error;
    }
    if (!isPurchase && presentation === 'unidad' && !product.permiteVentaPorUnidad) {
      const error = new Error(`${product.nombre} no permite venta por unidad.`);
      error.status = 400;
      throw error;
    }
    const unidades = equivalentUnits(product, cantidad, presentation, isPurchase);
    if (!isPurchase && asNumber(product.stockUnidadesTotal) < unidades) {
      const error = new Error(`Stock insuficiente para ${product.nombre}. Disponible: ${product.stockUnidadesTotal} unidades.`);
      error.status = 400;
      throw error;
    }
    const precio = isPurchase ? asNumber(item.precioCompra) : asNumber(product.precioVenta) * (presentation === 'paquete' ? product.unidadesPorPaquete : 1);
    if (precio <= 0) {
      const error = new Error(isPurchase ? 'El precio de compra debe ser mayor a cero.' : `El precio de venta de ${product.nombre} no es valido.`);
      error.status = 400;
      throw error;
    }
    const costoUnitario = asNumber(product.ultimoPrecioCompra);
    const subtotal = cantidad * precio;
    const subtotalCosto = isPurchase ? 0 : unidades * costoUnitario;
    normalized.push({ originalIndex, product, cantidad, presentation, unidades, precio, costoUnitario, subtotal, subtotalCosto, ganancia: subtotal - subtotalCosto });
  }
  return normalized.sort((a, b) => a.originalIndex - b.originalIndex);
}

router.post('/ventas', async (req, res, next) => {
  try {
    const idTienda = tenantId(req);
    const tipo = req.body.tipo === 'fiada' ? 'fiada' : 'pagada';
    const requestKey = operationKey(req.body.claveOperacion);
    if (tipo === 'fiada' && !req.body.idCliente) return res.status(400).json({ error: 'Una venta fiada debe tener cliente registrado.' });
    const result = await runTransaction(async (connection) => {
      if (req.body.idCliente) {
        await requireTenantRecord(connection, 'cliente', 'idCliente', req.body.idCliente, idTienda, 'AND activo=1');
      }
      const [venta] = await connection.query(
        `INSERT INTO venta (idTienda, total, tipo, idCliente, claveOperacion)
         VALUES (?, 0, ?, ?, ?)
         ON DUPLICATE KEY UPDATE idVenta=LAST_INSERT_ID(idVenta)`,
        [idTienda, tipo, req.body.idCliente || null, requestKey]
      );
      const [existing] = await connection.query(
        `SELECT v.idVenta, v.total, v.tipo, f.idFiado
         FROM venta v LEFT JOIN fiado f ON f.idVenta=v.idVenta AND f.idTienda=v.idTienda
         WHERE v.idVenta=? AND v.idTienda=?`,
        [venta.insertId, idTienda]
      );
      if (Number(existing[0].total) > 0) return { ...existing[0], repetida: true };
      const items = await validateItems(connection, req.body.items, 'venta', idTienda);
      const total = items.reduce((sum, item) => sum + item.subtotal, 0);
      await connection.query(
        'UPDATE venta SET total=? WHERE idVenta=? AND idTienda=?',
        [total, venta.insertId, idTienda]
      );
      for (const item of items) {
        const [detail] = await connection.query(
          `INSERT INTO detalleVenta
           (idTienda, idVenta, idProducto, cantidad, precioVenta, costoUnitario, subtotal, subtotalCosto, ganancia, presentacionVenta, cantidadEquivalenteUnidades)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [idTienda, venta.insertId, item.product.idProducto, item.cantidad, item.precio, item.costoUnitario, item.subtotal, item.subtotalCosto, item.ganancia, item.presentation, item.unidades]
        );
        const stockAnterior = Number(item.product.stockUnidadesTotal);
        const stockPosterior = stockAnterior - item.unidades;
        const [stockUpdate] = await connection.query(
          `UPDATE producto
           SET stockUnidadesTotal=?, stock=?
           WHERE idProducto=? AND idTienda=? AND activo=1 AND stockUnidadesTotal=?`,
          [stockPosterior, stockPosterior, item.product.idProducto, idTienda, stockAnterior]
        );
        if (!stockUpdate.affectedRows) throw notFound('Producto no encontrado o stock insuficiente.');
        await insertStockMovement(connection, {
          idTienda,
          idProducto: item.product.idProducto,
          tipoMovimiento: 'salida',
          origen: 'venta',
          cantidad: -item.unidades,
          stockAnterior,
          stockPosterior,
          cantidadOperacion: item.cantidad,
          unidadOperacion: item.presentation,
          motivo: tipo === 'fiada' ? 'Salida por venta fiada.' : 'Salida por venta pagada.',
          idDetalleVenta: detail.insertId,
          claveOperacion: movementKey('detalle-venta', detail.insertId),
          idAdministrador: req.session.admin.id
        });
      }
      let idFiado = null;
      if (tipo === 'fiada') {
        const [fiado] = await connection.query(
          'INSERT INTO fiado (idTienda, idCliente, idVenta, fechaInicio, totalFiado, totalPagado, saldoPendiente, estado) VALUES (?, ?, ?, CURDATE(), ?, 0, ?, ?)',
          [idTienda, req.body.idCliente, venta.insertId, total, total, 'pendiente']
        );
        idFiado = fiado.insertId;
      }
      return { idVenta: venta.insertId, idFiado, total, tipo };
    });
    res.status(201).json({ message: 'Venta registrada.', ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/ventas', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT v.*, COALESCE(c.nombre, 'CLIENTE OCASIONAL') AS cliente,
        f.idFiado, f.saldoPendiente, f.estado AS estadoFiado
      FROM venta v
      LEFT JOIN cliente c ON c.idCliente=v.idCliente AND c.idTienda=v.idTienda
      LEFT JOIN fiado f ON f.idVenta=v.idVenta AND f.idTienda=v.idTienda
      WHERE v.idTienda=?
      ORDER BY v.fecha DESC
      LIMIT 300
    `, [tenantId(req)]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/ventas/:id', async (req, res, next) => {
  try {
    const idTienda = tenantId(req);
    const [[ventas], [detalle], [pagos]] = await Promise.all([
      pool.query(`
        SELECT v.*, COALESCE(c.nombre, 'CLIENTE OCASIONAL') AS cliente,
          f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente, f.estado AS estadoFiado
        FROM venta v
        LEFT JOIN cliente c ON c.idCliente=v.idCliente AND c.idTienda=v.idTienda
        LEFT JOIN fiado f ON f.idVenta=v.idVenta AND f.idTienda=v.idTienda
        WHERE v.idVenta=? AND v.idTienda=?
      `, [req.params.id, idTienda]),
      pool.query(`
        SELECT d.*, p.nombre, p.unidadMedida, p.categoria
        FROM detalleVenta d
        JOIN producto p ON p.idProducto=d.idProducto AND p.idTienda=d.idTienda
        WHERE d.idVenta=? AND d.idTienda=?
      `, [req.params.id, idTienda]),
      pool.query(`
        SELECT pf.*
        FROM pagoFiado pf
        JOIN fiado f ON f.idFiado=pf.idFiado AND f.idTienda=pf.idTienda
        WHERE f.idVenta=? AND f.idTienda=? AND pf.idTienda=?
        ORDER BY pf.fechaPago DESC
      `, [req.params.id, idTienda, idTienda])
    ]);
    if (!ventas.length) return res.status(404).json({ error: 'Venta no encontrada.' });
    res.json({ venta: ventas[0], detalle, pagos });
  } catch (error) {
    next(error);
  }
});

router.post('/compras', async (req, res, next) => {
  try {
    const idTienda = tenantId(req);
    const requestKey = operationKey(req.body.claveOperacion);
    const result = await runTransaction(async (connection) => {
      if (req.body.idProveedor) {
        await requireTenantRecord(connection, 'proveedor', 'idProveedor', req.body.idProveedor, idTienda);
      }
      const [compra] = await connection.query(
        `INSERT INTO compra (idTienda, total, idProveedor, claveOperacion)
         VALUES (?, 0, ?, ?)
         ON DUPLICATE KEY UPDATE idCompra=LAST_INSERT_ID(idCompra)`,
        [idTienda, req.body.idProveedor || null, requestKey]
      );
      const [existing] = await connection.query(
        'SELECT idCompra, total FROM compra WHERE idCompra=? AND idTienda=?',
        [compra.insertId, idTienda]
      );
      if (Number(existing[0].total) > 0) return { ...existing[0], repetida: true };
      const items = await validateItems(connection, req.body.items, 'compra', idTienda);
      const total = items.reduce((sum, item) => sum + item.subtotal, 0);
      await connection.query(
        'UPDATE compra SET total=? WHERE idCompra=? AND idTienda=?',
        [total, compra.insertId, idTienda]
      );
      for (const item of items) {
        const costoUnitario = item.unidades > 0 ? item.subtotal / item.unidades : 0;
        const [detail] = await connection.query(
          `INSERT INTO detalleCompra
           (idTienda, idCompra, idProducto, cantidad, precioCompra, subtotal, presentacionCompra, cantidadEquivalenteUnidades)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [idTienda, compra.insertId, item.product.idProducto, item.cantidad, item.price || item.precio, item.subtotal, item.presentation, item.unidades]
        );
        const stockAnterior = Number(item.product.stockUnidadesTotal);
        const stockPosterior = stockAnterior + item.unidades;
        const [stockUpdate] = await connection.query(
          `UPDATE producto SET stockUnidadesTotal=?, stock=?, ultimoPrecioCompra=?
           WHERE idProducto=? AND idTienda=? AND activo=1 AND stockUnidadesTotal=?`,
          [stockPosterior, stockPosterior, costoUnitario, item.product.idProducto, idTienda, stockAnterior]
        );
        if (!stockUpdate.affectedRows) throw notFound('Producto no encontrado.');
        await insertStockMovement(connection, {
          idTienda,
          idProducto: item.product.idProducto,
          tipoMovimiento: 'entrada',
          origen: 'compra',
          cantidad: item.unidades,
          stockAnterior,
          stockPosterior,
          cantidadOperacion: item.cantidad,
          unidadOperacion: item.presentation,
          motivo: 'Entrada por compra.',
          idDetalleCompra: detail.insertId,
          claveOperacion: movementKey('detalle-compra', detail.insertId),
          idAdministrador: req.session.admin.id
        });
      }
      return { idCompra: compra.insertId, total };
    });
    res.status(201).json({ message: 'Compra registrada.', ...result });
  } catch (error) {
    next(error);
  }
});

router.post('/fiados', (req, res) => {
  res.status(410).json({ error: 'Los fiados nuevos deben registrarse desde Ventas como venta fiada.' });
});

router.get('/fiados', async (req, res, next) => {
  try {
    const { estado, idCliente, desde, hasta } = req.query;
    const conditions = ['f.idTienda=?', 'f.activo=1'];
    const params = [tenantId(req)];
    if (estado) {
      conditions.push('f.estado=?');
      params.push(estado);
    }
    if (idCliente) {
      conditions.push('f.idCliente=?');
      params.push(idCliente);
    }
    if (desde) {
      conditions.push('DATE(COALESCE(v.fecha, f.fechaInicio)) >= ?');
      params.push(desde);
    }
    if (hasta) {
      conditions.push('DATE(COALESCE(v.fecha, f.fechaInicio)) <= ?');
      params.push(hasta);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(`
      SELECT f.*, c.nombre AS cliente, v.fecha AS fechaVenta, v.total AS totalVenta
      FROM fiado f
      JOIN cliente c ON c.idCliente=f.idCliente AND c.idTienda=f.idTienda
      LEFT JOIN venta v ON v.idVenta=f.idVenta AND v.idTienda=f.idTienda
      ${where}
      ORDER BY f.idFiado DESC
    `, params);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/fiados/activos', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.*, c.nombre AS cliente, v.fecha AS fechaVenta
      FROM fiado f
      JOIN cliente c ON c.idCliente=f.idCliente AND c.idTienda=f.idTienda
      LEFT JOIN venta v ON v.idVenta=f.idVenta AND v.idTienda=f.idTienda
      WHERE f.idTienda=? AND f.activo=1 AND f.estado IN ('pendiente','parcial')
      ORDER BY f.idFiado DESC
    `, [tenantId(req)]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/fiados/ocultos', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.*, c.nombre AS cliente, v.fecha AS fechaVenta, v.total AS totalVenta
      FROM fiado f
      JOIN cliente c ON c.idCliente=f.idCliente AND c.idTienda=f.idTienda
      LEFT JOIN venta v ON v.idVenta=f.idVenta AND v.idTienda=f.idTienda
      WHERE f.idTienda=? AND f.activo=0
      ORDER BY f.eliminadoEn DESC, f.idFiado DESC
    `, [tenantId(req)]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/fiados/:id', async (req, res, next) => {
  try {
    const idTienda = tenantId(req);
    const [[fiados], [pagos], [detalleVenta], [detalleFiado]] = await Promise.all([
      pool.query(`
        SELECT f.*, c.nombre AS cliente, v.fecha AS fechaVenta, v.total AS totalVenta
        FROM fiado f
        JOIN cliente c ON c.idCliente=f.idCliente AND c.idTienda=f.idTienda
        LEFT JOIN venta v ON v.idVenta=f.idVenta AND v.idTienda=f.idTienda
        WHERE f.idFiado=? AND f.idTienda=?
      `, [req.params.id, idTienda]),
      pool.query(
        'SELECT * FROM pagoFiado WHERE idFiado=? AND idTienda=? ORDER BY fechaPago DESC',
        [req.params.id, idTienda]
      ),
      pool.query(`
        SELECT d.*, p.nombre, p.unidadMedida
        FROM detalleVenta d
        JOIN fiado f ON f.idVenta=d.idVenta AND f.idTienda=d.idTienda
        JOIN producto p ON p.idProducto=d.idProducto AND p.idTienda=d.idTienda
        WHERE f.idFiado=? AND f.idTienda=? AND d.idTienda=?
      `, [req.params.id, idTienda, idTienda]),
      pool.query(`
        SELECT d.*, p.nombre, p.unidadMedida
        FROM detalleFiado d
        JOIN producto p ON p.idProducto=d.idProducto AND p.idTienda=d.idTienda
        WHERE d.idFiado=? AND d.idTienda=?
      `, [req.params.id, idTienda])
    ]);
    if (!fiados.length) return res.status(404).json({ error: 'Fiado no encontrado.' });
    res.json({ fiado: fiados[0], pagos, detalle: detalleVenta.length ? detalleVenta : detalleFiado });
  } catch (error) {
    next(error);
  }
});

router.patch('/fiados/:id/restaurar', async (req, res, next) => {
  try {
    await requireAdminPassword(req);
    const [result] = await pool.query(
      'UPDATE fiado SET activo=1, eliminadoEn=NULL WHERE idFiado=? AND idTienda=? AND activo=0',
      [req.params.id, tenantId(req)]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Fiado oculto no encontrado.' });
    res.json({ message: 'Fiado restaurado.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.delete('/fiados/:id', async (req, res, next) => {
  try {
    await requireAdminPassword(req);
    const [result] = await pool.query(
      'UPDATE fiado SET activo=0, eliminadoEn=NOW() WHERE idFiado=? AND idTienda=? AND activo=1',
      [req.params.id, tenantId(req)]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Fiado no encontrado o ya está oculto.' });
    res.json({ message: 'Fiado ocultado. Los pagos e historial se conservan.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post('/pagos-fiado', async (req, res, next) => {
  try {
    requireFields(req.body, ['idFiado', 'monto']);
    const monto = asNumber(req.body.monto);
    const idTienda = tenantId(req);
    if (monto <= 0) return res.status(400).json({ error: 'El pago debe ser mayor a cero.' });
    await runTransaction(async (connection) => {
      const [rows] = await connection.query(
        'SELECT * FROM fiado WHERE idFiado=? AND idTienda=? AND activo=1 FOR UPDATE',
        [req.body.idFiado, idTienda]
      );
      if (rows.length === 0) {
        const error = new Error('Fiado no encontrado.');
        error.status = 404;
        throw error;
      }
      const fiado = rows[0];
      if (monto > asNumber(fiado.saldoPendiente)) {
        const error = new Error('El pago no puede superar el saldo pendiente.');
        error.status = 400;
        throw error;
      }
      await connection.query(
        'INSERT INTO pagoFiado (idTienda, idFiado, monto, observacion) VALUES (?, ?, ?, ?)',
        [idTienda, req.body.idFiado, monto, nullableText(req.body.observacion)]
      );
      const totalPagado = asNumber(fiado.totalPagado) + monto;
      const saldo = Math.max(0, asNumber(fiado.totalFiado) - totalPagado);
      const estado = saldo === 0 ? 'pagado' : 'parcial';
      await connection.query(
        'UPDATE fiado SET totalPagado=?, saldoPendiente=?, estado=? WHERE idFiado=? AND idTienda=?',
        [totalPagado, saldo, estado, req.body.idFiado, idTienda]
      );
    });
    res.status(201).json({ message: 'Pago registrado.' });
  } catch (error) {
    next(error);
  }
});

router.post('/pagos-fiado/cliente', async (req, res, next) => {
  try {
    requireFields(req.body, ['idCliente', 'monto']);
    const monto = asNumber(req.body.monto);
    const idTienda = tenantId(req);
    if (monto <= 0) return res.status(400).json({ error: 'El pago debe ser mayor a cero.' });

    const result = await runTransaction(async (connection) => {
      await requireTenantRecord(connection, 'cliente', 'idCliente', req.body.idCliente, idTienda);
      const [fiados] = await connection.query(
        `SELECT *
         FROM fiado
         WHERE idCliente=? AND idTienda=? AND activo=1 AND estado IN ('pendiente','parcial')
         ORDER BY fechaInicio ASC, idFiado ASC
         FOR UPDATE`,
        [req.body.idCliente, idTienda]
      );
      if (!fiados.length) {
        const error = new Error('El cliente no tiene deudas pendientes.');
        error.status = 400;
        throw error;
      }

      const saldoAcumulado = fiados.reduce((sum, fiado) => sum + asNumber(fiado.saldoPendiente), 0);
      if (monto > saldoAcumulado) {
        const error = new Error(`El pago no puede superar el saldo acumulado de Bs ${saldoAcumulado.toFixed(2)}.`);
        error.status = 400;
        throw error;
      }

      let restante = monto;
      const aplicaciones = [];
      const observacion = nullableText(req.body.observacion || 'Pago acumulado');

      for (const fiado of fiados) {
        if (restante <= 0) break;
        const saldoActual = asNumber(fiado.saldoPendiente);
        const aplicado = Math.min(restante, saldoActual);
        if (aplicado <= 0) continue;

        await connection.query(
          'INSERT INTO pagoFiado (idTienda, idFiado, monto, observacion) VALUES (?, ?, ?, ?)',
          [idTienda, fiado.idFiado, aplicado, observacion]
        );

        const totalPagado = asNumber(fiado.totalPagado) + aplicado;
        const saldo = Math.max(0, asNumber(fiado.totalFiado) - totalPagado);
        const estado = saldo === 0 ? 'pagado' : 'parcial';
        await connection.query(
          'UPDATE fiado SET totalPagado=?, saldoPendiente=?, estado=? WHERE idFiado=? AND idTienda=?',
          [totalPagado, saldo, estado, fiado.idFiado, idTienda]
        );

        aplicaciones.push({ idFiado: fiado.idFiado, monto: aplicado, saldoPendiente: saldo, estado });
        restante = Number((restante - aplicado).toFixed(2));
      }

      return { saldoAcumulado, montoAplicado: monto, aplicaciones };
    });

    res.status(201).json({ message: 'Pago acumulado registrado.', ...result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

function gainRange(period, desde, hasta) {
  if (period === 'dia') return ['DATE(v.fecha)=CURDATE()', []];
  if (period === 'semana') return ['YEARWEEK(v.fecha, 1)=YEARWEEK(CURDATE(), 1)', []];
  if (period === 'mes') return ['YEAR(v.fecha)=YEAR(CURDATE()) AND MONTH(v.fecha)=MONTH(CURDATE())', []];
  if (period === 'anio') return ['YEAR(v.fecha)=YEAR(CURDATE())', []];
  return ['DATE(v.fecha) BETWEEN ? AND ?', [desde || '1000-01-01', hasta || '9999-12-31']];
}

router.get('/reportes/:tipo', async (req, res, next) => {
  try {
    const idTienda = tenantId(req);
    const { tipo } = req.params;
    const { desde, hasta, idProveedor, idCliente, estado, periodo } = req.query;
    const range = [desde || '1000-01-01', hasta || '9999-12-31'];
    let rows = [];
    let chart = null;
    let summary = null;

    if (tipo === 'ventasDia' || tipo === 'ventasRango') {
      const dateWhere = tipo === 'ventasDia' ? 'DATE(v.fecha)=CURDATE()' : 'DATE(v.fecha) BETWEEN ? AND ?';
      const params = tipo === 'ventasDia' ? [idTienda] : [idTienda, ...range];
      [rows] = await pool.query(`
        SELECT v.idVenta, v.fecha, COALESCE(c.nombre, 'CLIENTE OCASIONAL') cliente, v.tipo, v.total, COALESCE(f.estado, 'pagado') estado
        FROM venta v
        LEFT JOIN cliente c ON c.idCliente=v.idCliente AND c.idTienda=v.idTienda
        LEFT JOIN fiado f ON f.idVenta=v.idVenta AND f.idTienda=v.idTienda
        WHERE v.idTienda=? AND ${dateWhere}
        ORDER BY v.fecha DESC
      `, params);
      chart = { type: 'bar', labels: rows.map((r) => r.fecha), values: rows.map((r) => Number(r.total)) };
    } else if (tipo === 'bajoStock') {
      [rows] = await pool.query(
        `${productSelect('WHERE p.idTienda=? AND p.activo=1 AND p.stockUnidadesTotal < p.stockMinimo')} ORDER BY p.nombre`,
        [idTienda]
      );
      chart = { type: 'bar', labels: rows.map((r) => r.nombre), values: rows.map((r) => Number(r.stockUnidadesTotal)) };
    } else if (tipo === 'masVendidos') {
      [rows] = await pool.query(`
        SELECT p.nombre, p.categoria, SUM(d.cantidadEquivalenteUnidades) unidadesVendidas, SUM(d.subtotal) totalVendido
        FROM detalleVenta d
        JOIN producto p ON p.idProducto=d.idProducto AND p.idTienda=d.idTienda
        WHERE d.idTienda=?
        GROUP BY p.idTienda, p.idProducto
        ORDER BY unidadesVendidas DESC
        LIMIT 20
      `, [idTienda]);
      chart = { type: 'bar', labels: rows.map((r) => r.nombre), values: rows.map((r) => Number(r.unidadesVendidas)) };
    } else if (['fiadosPendientes', 'fiadosParciales', 'fiadosPagados', 'fiados'].includes(tipo)) {
      const requestedState = tipo === 'fiadosPendientes' ? 'pendiente' : tipo === 'fiadosParciales' ? 'parcial' : tipo === 'fiadosPagados' ? 'pagado' : estado;
      const conditions = ['f.idTienda=?'];
      const params = [idTienda];
      if (requestedState) { conditions.push('f.estado=?'); params.push(requestedState); }
      if (idCliente) { conditions.push('f.idCliente=?'); params.push(idCliente); }
      if (desde) { conditions.push('DATE(COALESCE(v.fecha, f.fechaInicio)) >= ?'); params.push(desde); }
      if (hasta) { conditions.push('DATE(COALESCE(v.fecha, f.fechaInicio)) <= ?'); params.push(hasta); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      [rows] = await pool.query(`
        SELECT f.*, c.nombre cliente, v.fecha fechaVenta
        FROM fiado f
        JOIN cliente c ON c.idCliente=f.idCliente AND c.idTienda=f.idTienda
        LEFT JOIN venta v ON v.idVenta=f.idVenta AND v.idTienda=f.idTienda
        ${where}
        ORDER BY f.fechaInicio DESC
      `, params);
      const counts = { pendiente: 0, parcial: 0, pagado: 0 };
      rows.forEach((row) => { counts[row.estado] += 1; });
      chart = { type: 'bar', labels: Object.keys(counts), values: Object.values(counts) };
    } else if (tipo === 'pagosFiado') {
      [rows] = await pool.query(`
        SELECT p.idPagoFiado, p.fechaPago, c.nombre cliente, p.monto, p.observacion, f.estado, f.saldoPendiente
        FROM pagoFiado p
        JOIN fiado f ON f.idFiado=p.idFiado AND f.idTienda=p.idTienda
        JOIN cliente c ON c.idCliente=f.idCliente AND c.idTienda=f.idTienda
        WHERE p.idTienda=?
        ORDER BY p.fechaPago DESC
      `, [idTienda]);
      chart = { type: 'bar', labels: rows.map((r) => r.fechaPago), values: rows.map((r) => Number(r.monto)) };
    } else if (tipo === 'compras' || tipo === 'comprasProveedor') {
      const conditions = ['co.idTienda=?', 'DATE(co.fecha) BETWEEN ? AND ?'];
      const params = [idTienda, ...range];
      if (tipo === 'comprasProveedor' && idProveedor) { conditions.push('co.idProveedor=?'); params.push(idProveedor); }
      [rows] = await pool.query(`
        SELECT co.idCompra, co.fecha, COALESCE(pr.nombre, 'SIN PROVEEDOR') proveedor, co.total
        FROM compra co
        LEFT JOIN proveedor pr ON pr.idProveedor=co.idProveedor AND pr.idTienda=co.idTienda
        WHERE ${conditions.join(' AND ')}
        ORDER BY co.fecha DESC
      `, params);
      chart = { type: 'bar', labels: rows.map((r) => r.proveedor), values: rows.map((r) => Number(r.total)) };
    } else if (tipo === 'ganancias') {
      const [where, params] = gainRange(periodo || 'mes', desde, hasta);
      [rows] = await pool.query(`
        SELECT DATE(v.fecha) fecha, SUM(d.subtotal) totalVendido, SUM(d.subtotalCosto) totalCosto, SUM(d.ganancia) gananciaNeta
        FROM detalleVenta d
        JOIN venta v ON v.idVenta=d.idVenta AND v.idTienda=d.idTienda
        WHERE d.idTienda=? AND v.idTienda=? AND ${where}
        GROUP BY DATE(v.fecha)
        ORDER BY fecha
      `, [idTienda, idTienda, ...params]);
      summary = rows.reduce((acc, row) => {
        acc.totalVendido += Number(row.totalVendido || 0);
        acc.totalCosto += Number(row.totalCosto || 0);
        acc.gananciaNeta += Number(row.gananciaNeta || 0);
        return acc;
      }, { totalVendido: 0, totalCosto: 0, gananciaNeta: 0 });
      chart = { type: 'line', labels: rows.map((r) => r.fecha), values: rows.map((r) => Number(r.gananciaNeta)) };
    } else {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }

    res.json({ rows, chart, summary });
  } catch (error) {
    next(error);
  }
});

router.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 ? 'Ocurrio un error interno.' : err.message
  });
});

module.exports = router;
