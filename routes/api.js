const express = require('express');
const pool = require('../config/db');

const router = express.Router();

const units = ['unidad', 'paquete', 'kilo', 'gramo', 'litro', 'mililitro', 'caja', 'docena', 'bolsa'];
const categories = ['LACTEOS', 'LIMPIEZA', 'BEBIDAS', 'SNACKS', 'ABARROTES', 'ASEO PERSONAL', 'CONDIMENTOS', 'OTROS'];
const purchasePresentations = ['caja', 'paquete', 'unidad'];
const salePresentations = ['paquete', 'unidad'];

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function nullableUpper(value) {
  const text = upper(value);
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
    LEFT JOIN proveedor pr ON pr.idProveedor = p.idProveedor
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
  if (editing && body.stockUnidadesTotal === undefined && body.stock === undefined) {
    requireFields(body, ['stockUnidadesTotal']);
  }
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
    ? asPositiveInteger(Number(body.stockUnidadesTotal), 'Stock total', true)
    : asPositiveInteger(Number(body.stockUnidadesTotal || body.stock || 0), 'Stock total', true);
  return {
    nombre: upper(body.nombre),
    idProveedor: body.idProveedor || null,
    categoria,
    unidadMedida: body.unidadMedida,
    unidadesPorPaquete,
    paquetesPorCaja,
    precioVenta: asNumber(body.precioVenta),
    stockUnidadesTotal,
    stockMinimo: asPositiveInteger(Number(body.stockMinimo), 'Stock minimo'),
    ultimoPrecioCompra: asNumber(body.ultimoPrecioCompra || 0),
    permiteVentaPorPaquete,
    permiteVentaPorUnidad
  };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const [[ventasHoy], [ventasAyer], [ventasMes], [ventasMesPasado], [gananciaHoy], [gananciaMes], [bajoStock], [fiadosEstado], [ventasDias]] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE DATE(fecha) = CURDATE()'),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE DATE(fecha) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)'),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE YEAR(fecha)=YEAR(CURDATE()) AND MONTH(fecha)=MONTH(CURDATE())'),
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE YEAR(fecha)=YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND MONTH(fecha)=MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))'),
      pool.query('SELECT COALESCE(SUM(ganancia), 0) total FROM detalleVenta d JOIN venta v ON v.idVenta=d.idVenta WHERE DATE(v.fecha)=CURDATE()'),
      pool.query('SELECT COALESCE(SUM(ganancia), 0) total FROM detalleVenta d JOIN venta v ON v.idVenta=d.idVenta WHERE YEAR(v.fecha)=YEAR(CURDATE()) AND MONTH(v.fecha)=MONTH(CURDATE())'),
      pool.query('SELECT COUNT(*) total FROM producto WHERE stockUnidadesTotal < stockMinimo'),
      pool.query("SELECT estado, COUNT(*) total FROM fiado GROUP BY estado"),
      pool.query("SELECT DATE(fecha) dia, COALESCE(SUM(total),0) total FROM venta WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(fecha) ORDER BY dia")
    ]);
    const estados = { pendiente: 0, parcial: 0, pagado: 0 };
    fiadosEstado.forEach((row) => { estados[row.estado] = row.total; });
    res.json({
      ventasHoy: ventasHoy[0].total,
      ventasAyer: ventasAyer[0].total,
      ventasMes: ventasMes[0].total,
      ventasMesPasado: ventasMesPasado[0].total,
      gananciaHoy: gananciaHoy[0].total,
      gananciaMes: gananciaMes[0].total,
      bajoStock: bajoStock[0].total,
      fiados: estados,
      chartVentasDias: ventasDias
    });
  } catch (error) {
    next(error);
  }
});

router.get('/categorias', (req, res) => {
  res.json(categories);
});

router.get('/productos', async (req, res, next) => {
  try {
    const { q, idProveedor, categoria, bajoStock, sort } = req.query;
    const conditions = [];
    const params = [];
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
  try {
    const data = validateProductPayload(req.body);
    await pool.query(
      `INSERT INTO producto
       (nombre, idProveedor, categoria, unidadMedida, unidadesPorPaquete, paquetesPorCaja, precioVenta, stock, stockMinimo, stockUnidadesTotal, ultimoPrecioCompra, permiteVentaPorPaquete, permiteVentaPorUnidad)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.nombre, data.idProveedor, data.categoria, data.unidadMedida, data.unidadesPorPaquete, data.paquetesPorCaja, data.precioVenta, data.stockUnidadesTotal, data.stockMinimo, data.stockUnidadesTotal, data.ultimoPrecioCompra, data.permiteVentaPorPaquete, data.permiteVentaPorUnidad]
    );
    res.status(201).json({ message: 'Producto guardado.' });
  } catch (error) {
    next(error);
  }
});

router.put('/productos/:id', async (req, res, next) => {
  try {
    const data = validateProductPayload(req.body, true);
    await pool.query(
      `UPDATE producto
       SET nombre=?, idProveedor=?, categoria=?, unidadMedida=?, unidadesPorPaquete=?, paquetesPorCaja=?, precioVenta=?, stock=?, stockMinimo=?, stockUnidadesTotal=?, ultimoPrecioCompra=?, permiteVentaPorPaquete=?, permiteVentaPorUnidad=?
       WHERE idProducto=?`,
      [data.nombre, data.idProveedor, data.categoria, data.unidadMedida, data.unidadesPorPaquete, data.paquetesPorCaja, data.precioVenta, data.stockUnidadesTotal, data.stockMinimo, data.stockUnidadesTotal, data.ultimoPrecioCompra, data.permiteVentaPorPaquete, data.permiteVentaPorUnidad, req.params.id]
    );
    res.json({ message: 'Producto actualizado.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/productos/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM producto WHERE idProducto=?', [req.params.id]);
    res.json({ message: 'Producto eliminado.' });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'No se puede eliminar porque tiene registros asociados.' });
    next(error);
  }
});

function crudRoutes(base, table, idField, protectedDeleteMessage) {
  router.get(`/${base}`, async (req, res, next) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY nombre`);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${base}`, async (req, res, next) => {
    try {
      requireFields(req.body, ['nombre']);
      const nombre = upper(req.body.nombre);
      const telefono = validatePhone(req.body.telefono);
      if (table === 'proveedor') {
        await pool.query('INSERT INTO proveedor (nombre, telefono, direccion) VALUES (?, ?, ?)', [nombre, telefono, nullableUpper(req.body.direccion)]);
      } else {
        await pool.query('INSERT INTO cliente (nombre, telefono) VALUES (?, ?)', [nombre, telefono]);
      }
      res.status(201).json({ message: 'Registro guardado.' });
    } catch (error) {
      next(error);
    }
  });

  router.put(`/${base}/:id`, async (req, res, next) => {
    try {
      requireFields(req.body, ['nombre']);
      const nombre = upper(req.body.nombre);
      const telefono = validatePhone(req.body.telefono);
      if (table === 'proveedor') {
        await pool.query('UPDATE proveedor SET nombre=?, telefono=?, direccion=? WHERE idProveedor=?', [nombre, telefono, nullableUpper(req.body.direccion), req.params.id]);
      } else {
        await pool.query('UPDATE cliente SET nombre=?, telefono=? WHERE idCliente=?', [nombre, telefono, req.params.id]);
      }
      res.json({ message: 'Registro actualizado.' });
    } catch (error) {
      next(error);
    }
  });

  router.delete(`/${base}/:id`, async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM ${table} WHERE ${idField}=?`, [req.params.id]);
      res.json({ message: 'Registro eliminado.' });
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: protectedDeleteMessage });
      next(error);
    }
  });
}

crudRoutes('clientes', 'cliente', 'idCliente', 'No se puede eliminar el cliente porque tiene ventas o fiados asociados.');
crudRoutes('proveedores', 'proveedor', 'idProveedor', 'No se puede eliminar el proveedor porque tiene compras o productos asociados.');

async function validateItems(connection, items, type) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('Debe agregar al menos un producto.');
    error.status = 400;
    throw error;
  }
  const isPurchase = type === 'compra';
  const normalized = [];
  for (const item of items) {
    const cantidad = asPositiveInteger(Number(item.cantidad), 'Cantidad');
    if (!item.idProducto) {
      const error = new Error('Cada producto debe tener un producto seleccionado.');
      error.status = 400;
      throw error;
    }
    const presentation = item.presentacion || item.modoCompra || (isPurchase ? 'unidad' : 'unidad');
    const validPresentations = isPurchase ? purchasePresentations : salePresentations;
    if (!validPresentations.includes(presentation)) {
      const error = new Error(isPurchase ? 'Presentacion de compra invalida.' : 'Presentacion de venta invalida.');
      error.status = 400;
      throw error;
    }
    const [rows] = await connection.query(`${productSelect('WHERE p.idProducto=?')} FOR UPDATE`, [item.idProducto]);
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
    const costoUnitario = asNumber(product.ultimoPrecioCompra);
    const subtotal = cantidad * precio;
    const subtotalCosto = isPurchase ? 0 : unidades * costoUnitario;
    normalized.push({ product, cantidad, presentation, unidades, precio, costoUnitario, subtotal, subtotalCosto, ganancia: subtotal - subtotalCosto });
  }
  return normalized;
}

router.post('/ventas', async (req, res, next) => {
  try {
    const tipo = req.body.tipo === 'fiada' ? 'fiada' : 'pagada';
    if (tipo === 'fiada' && !req.body.idCliente) return res.status(400).json({ error: 'Una venta fiada debe tener cliente registrado.' });
    const result = await runTransaction(async (connection) => {
      const items = await validateItems(connection, req.body.items, 'venta');
      const total = items.reduce((sum, item) => sum + item.subtotal, 0);
      const [venta] = await connection.query('INSERT INTO venta (total, tipo, idCliente) VALUES (?, ?, ?)', [total, tipo, req.body.idCliente || null]);
      for (const item of items) {
        await connection.query(
          `INSERT INTO detalleVenta
           (idVenta, idProducto, cantidad, precioVenta, costoUnitario, subtotal, subtotalCosto, ganancia, presentacionVenta, cantidadEquivalenteUnidades)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [venta.insertId, item.product.idProducto, item.cantidad, item.precio, item.costoUnitario, item.subtotal, item.subtotalCosto, item.ganancia, item.presentation, item.unidades]
        );
        await connection.query('UPDATE producto SET stockUnidadesTotal = stockUnidadesTotal - ?, stock = stock - ? WHERE idProducto=?', [item.unidades, item.unidades, item.product.idProducto]);
      }
      let idFiado = null;
      if (tipo === 'fiada') {
        const [fiado] = await connection.query(
          'INSERT INTO fiado (idCliente, idVenta, fechaInicio, totalFiado, totalPagado, saldoPendiente, estado) VALUES (?, ?, CURDATE(), ?, 0, ?, ?)',
          [req.body.idCliente, venta.insertId, total, total, 'pendiente']
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
      LEFT JOIN cliente c ON c.idCliente = v.idCliente
      LEFT JOIN fiado f ON f.idVenta = v.idVenta
      ORDER BY v.fecha DESC
      LIMIT 300
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/ventas/:id', async (req, res, next) => {
  try {
    const [[ventas], [detalle], [pagos]] = await Promise.all([
      pool.query(`
        SELECT v.*, COALESCE(c.nombre, 'CLIENTE OCASIONAL') AS cliente,
          f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente, f.estado AS estadoFiado
        FROM venta v
        LEFT JOIN cliente c ON c.idCliente = v.idCliente
        LEFT JOIN fiado f ON f.idVenta = v.idVenta
        WHERE v.idVenta=?
      `, [req.params.id]),
      pool.query(`
        SELECT d.*, p.nombre, p.unidadMedida, p.categoria
        FROM detalleVenta d
        JOIN producto p ON p.idProducto=d.idProducto
        WHERE d.idVenta=?
      `, [req.params.id]),
      pool.query(`
        SELECT pf.*
        FROM pagoFiado pf
        JOIN fiado f ON f.idFiado=pf.idFiado
        WHERE f.idVenta=?
        ORDER BY pf.fechaPago DESC
      `, [req.params.id])
    ]);
    if (!ventas.length) return res.status(404).json({ error: 'Venta no encontrada.' });
    res.json({ venta: ventas[0], detalle, pagos });
  } catch (error) {
    next(error);
  }
});

router.post('/compras', async (req, res, next) => {
  try {
    const result = await runTransaction(async (connection) => {
      const items = await validateItems(connection, req.body.items, 'compra');
      const total = items.reduce((sum, item) => sum + item.subtotal, 0);
      const [compra] = await connection.query('INSERT INTO compra (total, idProveedor) VALUES (?, ?)', [total, req.body.idProveedor || null]);
      for (const item of items) {
        const costoUnitario = item.unidades > 0 ? item.subtotal / item.unidades : 0;
        await connection.query(
          `INSERT INTO detalleCompra
           (idCompra, idProducto, cantidad, precioCompra, subtotal, presentacionCompra, cantidadEquivalenteUnidades)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [compra.insertId, item.product.idProducto, item.cantidad, item.price || item.precio, item.subtotal, item.presentation, item.unidades]
        );
        await connection.query(
          'UPDATE producto SET stockUnidadesTotal = stockUnidadesTotal + ?, stock = stock + ?, ultimoPrecioCompra=? WHERE idProducto=?',
          [item.unidades, item.unidades, costoUnitario, item.product.idProducto]
        );
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
    const conditions = [];
    const params = [];
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
      JOIN cliente c ON c.idCliente=f.idCliente
      LEFT JOIN venta v ON v.idVenta=f.idVenta
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
      JOIN cliente c ON c.idCliente=f.idCliente
      LEFT JOIN venta v ON v.idVenta=f.idVenta
      WHERE f.estado IN ('pendiente','parcial')
      ORDER BY f.idFiado DESC
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/fiados/:id', async (req, res, next) => {
  try {
    const [[fiados], [pagos], [detalleVenta], [detalleFiado]] = await Promise.all([
      pool.query(`
        SELECT f.*, c.nombre AS cliente, v.fecha AS fechaVenta, v.total AS totalVenta
        FROM fiado f
        JOIN cliente c ON c.idCliente=f.idCliente
        LEFT JOIN venta v ON v.idVenta=f.idVenta
        WHERE f.idFiado=?
      `, [req.params.id]),
      pool.query('SELECT * FROM pagoFiado WHERE idFiado=? ORDER BY fechaPago DESC', [req.params.id]),
      pool.query(`
        SELECT d.*, p.nombre, p.unidadMedida
        FROM detalleVenta d
        JOIN fiado f ON f.idVenta=d.idVenta
        JOIN producto p ON p.idProducto=d.idProducto
        WHERE f.idFiado=?
      `, [req.params.id]),
      pool.query(`
        SELECT d.*, p.nombre, p.unidadMedida
        FROM detalleFiado d
        JOIN producto p ON p.idProducto=d.idProducto
        WHERE d.idFiado=?
      `, [req.params.id])
    ]);
    if (!fiados.length) return res.status(404).json({ error: 'Fiado no encontrado.' });
    res.json({ fiado: fiados[0], pagos, detalle: detalleVenta.length ? detalleVenta : detalleFiado });
  } catch (error) {
    next(error);
  }
});

router.post('/pagos-fiado', async (req, res, next) => {
  try {
    requireFields(req.body, ['idFiado', 'monto']);
    const monto = asNumber(req.body.monto);
    if (monto <= 0) return res.status(400).json({ error: 'El pago debe ser mayor a cero.' });
    await runTransaction(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM fiado WHERE idFiado=? FOR UPDATE', [req.body.idFiado]);
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
      await connection.query('INSERT INTO pagoFiado (idFiado, monto, observacion) VALUES (?, ?, ?)', [req.body.idFiado, monto, nullableUpper(req.body.observacion)]);
      const totalPagado = asNumber(fiado.totalPagado) + monto;
      const saldo = Math.max(0, asNumber(fiado.totalFiado) - totalPagado);
      const estado = saldo === 0 ? 'pagado' : 'parcial';
      await connection.query('UPDATE fiado SET totalPagado=?, saldoPendiente=?, estado=? WHERE idFiado=?', [totalPagado, saldo, estado, req.body.idFiado]);
    });
    res.status(201).json({ message: 'Pago registrado.' });
  } catch (error) {
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
    const { tipo } = req.params;
    const { desde, hasta, idProveedor, idCliente, estado, periodo } = req.query;
    const range = [desde || '1000-01-01', hasta || '9999-12-31'];
    let rows = [];
    let chart = null;
    let summary = null;

    if (tipo === 'ventasDia' || tipo === 'ventasRango') {
      const dateWhere = tipo === 'ventasDia' ? 'DATE(v.fecha)=CURDATE()' : 'DATE(v.fecha) BETWEEN ? AND ?';
      const params = tipo === 'ventasDia' ? [] : range;
      [rows] = await pool.query(`
        SELECT v.idVenta, v.fecha, COALESCE(c.nombre, 'CLIENTE OCASIONAL') cliente, v.tipo, v.total, COALESCE(f.estado, 'pagado') estado
        FROM venta v
        LEFT JOIN cliente c ON c.idCliente=v.idCliente
        LEFT JOIN fiado f ON f.idVenta=v.idVenta
        WHERE ${dateWhere}
        ORDER BY v.fecha DESC
      `, params);
      chart = { type: 'bar', labels: rows.map((r) => r.fecha), values: rows.map((r) => Number(r.total)) };
    } else if (tipo === 'bajoStock') {
      [rows] = await pool.query(`${productSelect('WHERE p.stockUnidadesTotal < p.stockMinimo')} ORDER BY p.nombre`);
      chart = { type: 'bar', labels: rows.map((r) => r.nombre), values: rows.map((r) => Number(r.stockUnidadesTotal)) };
    } else if (tipo === 'masVendidos') {
      [rows] = await pool.query(`
        SELECT p.nombre, p.categoria, SUM(d.cantidadEquivalenteUnidades) unidadesVendidas, SUM(d.subtotal) totalVendido
        FROM detalleVenta d
        JOIN producto p ON p.idProducto=d.idProducto
        GROUP BY p.idProducto
        ORDER BY unidadesVendidas DESC
        LIMIT 20
      `);
      chart = { type: 'bar', labels: rows.map((r) => r.nombre), values: rows.map((r) => Number(r.unidadesVendidas)) };
    } else if (['fiadosPendientes', 'fiadosParciales', 'fiadosPagados', 'fiados'].includes(tipo)) {
      const requestedState = tipo === 'fiadosPendientes' ? 'pendiente' : tipo === 'fiadosParciales' ? 'parcial' : tipo === 'fiadosPagados' ? 'pagado' : estado;
      const conditions = [];
      const params = [];
      if (requestedState) { conditions.push('f.estado=?'); params.push(requestedState); }
      if (idCliente) { conditions.push('f.idCliente=?'); params.push(idCliente); }
      if (desde) { conditions.push('DATE(COALESCE(v.fecha, f.fechaInicio)) >= ?'); params.push(desde); }
      if (hasta) { conditions.push('DATE(COALESCE(v.fecha, f.fechaInicio)) <= ?'); params.push(hasta); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      [rows] = await pool.query(`
        SELECT f.*, c.nombre cliente, v.fecha fechaVenta
        FROM fiado f
        JOIN cliente c ON c.idCliente=f.idCliente
        LEFT JOIN venta v ON v.idVenta=f.idVenta
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
        JOIN fiado f ON f.idFiado=p.idFiado
        JOIN cliente c ON c.idCliente=f.idCliente
        ORDER BY p.fechaPago DESC
      `);
      chart = { type: 'bar', labels: rows.map((r) => r.fechaPago), values: rows.map((r) => Number(r.monto)) };
    } else if (tipo === 'compras' || tipo === 'comprasProveedor') {
      const conditions = ['DATE(co.fecha) BETWEEN ? AND ?'];
      const params = [...range];
      if (tipo === 'comprasProveedor' && idProveedor) { conditions.push('co.idProveedor=?'); params.push(idProveedor); }
      [rows] = await pool.query(`
        SELECT co.idCompra, co.fecha, COALESCE(pr.nombre, 'SIN PROVEEDOR') proveedor, co.total
        FROM compra co
        LEFT JOIN proveedor pr ON pr.idProveedor=co.idProveedor
        WHERE ${conditions.join(' AND ')}
        ORDER BY co.fecha DESC
      `, params);
      chart = { type: 'bar', labels: rows.map((r) => r.proveedor), values: rows.map((r) => Number(r.total)) };
    } else if (tipo === 'ganancias') {
      const [where, params] = gainRange(periodo || 'mes', desde, hasta);
      [rows] = await pool.query(`
        SELECT DATE(v.fecha) fecha, SUM(d.subtotal) totalVendido, SUM(d.subtotalCosto) totalCosto, SUM(d.ganancia) gananciaNeta
        FROM detalleVenta d
        JOIN venta v ON v.idVenta=d.idVenta
        WHERE ${where}
        GROUP BY DATE(v.fecha)
        ORDER BY fecha
      `, params);
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
  res.status(err.status || 500).json({ error: err.message || 'Ocurrio un error.' });
});

module.exports = router;
