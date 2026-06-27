const express = require('express');
const pool = require('../config/db');

const router = express.Router();
const units = ['unidad', 'paquete', 'kilo', 'gramo', 'litro', 'mililitro', 'caja', 'docena', 'bolsa'];

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

router.get('/dashboard', async (req, res, next) => {
  try {
    const [[ventasHoy], [bajoStock], [fiados], [productos]] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(total), 0) total FROM venta WHERE DATE(fecha) = CURDATE()'),
      pool.query('SELECT COUNT(*) total FROM producto WHERE stock < stockMinimo'),
      pool.query("SELECT COUNT(*) total FROM fiado WHERE estado IN ('pendiente','parcial')"),
      pool.query('SELECT COUNT(*) total FROM producto')
    ]);
    res.json({
      ventasHoy: ventasHoy[0].total,
      bajoStock: bajoStock[0].total,
      fiadosActivos: fiados[0].total,
      productos: productos[0].total
    });
  } catch (error) {
    next(error);
  }
});

router.get('/productos', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT *, stock < stockMinimo AS bajoStock FROM producto ORDER BY nombre');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/productos', async (req, res, next) => {
  try {
    requireFields(req.body, ['nombre', 'unidadMedida', 'precioVenta']);
    if (!units.includes(req.body.unidadMedida)) return res.status(400).json({ error: 'Unidad de medida invalida.' });
    await pool.query(
      'INSERT INTO producto (nombre, unidadMedida, precioVenta, stock, stockMinimo) VALUES (?, ?, ?, ?, ?)',
      [req.body.nombre, req.body.unidadMedida, asNumber(req.body.precioVenta), asNumber(req.body.stock), asNumber(req.body.stockMinimo || 5)]
    );
    res.status(201).json({ message: 'Producto guardado.' });
  } catch (error) {
    next(error);
  }
});

router.put('/productos/:id', async (req, res, next) => {
  try {
    requireFields(req.body, ['nombre', 'unidadMedida', 'precioVenta', 'stockMinimo']);
    await pool.query(
      'UPDATE producto SET nombre=?, unidadMedida=?, precioVenta=?, stock=?, stockMinimo=? WHERE idProducto=?',
      [req.body.nombre, req.body.unidadMedida, asNumber(req.body.precioVenta), asNumber(req.body.stock), asNumber(req.body.stockMinimo), req.params.id]
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
      if (table === 'proveedor') {
        await pool.query('INSERT INTO proveedor (nombre, telefono, direccion) VALUES (?, ?, ?)', [req.body.nombre, req.body.telefono || null, req.body.direccion || null]);
      } else {
        await pool.query('INSERT INTO cliente (nombre, telefono) VALUES (?, ?)', [req.body.nombre, req.body.telefono || null]);
      }
      res.status(201).json({ message: 'Registro guardado.' });
    } catch (error) {
      next(error);
    }
  });

  router.put(`/${base}/:id`, async (req, res, next) => {
    try {
      requireFields(req.body, ['nombre']);
      if (table === 'proveedor') {
        await pool.query('UPDATE proveedor SET nombre=?, telefono=?, direccion=? WHERE idProveedor=?', [req.body.nombre, req.body.telefono || null, req.body.direccion || null, req.params.id]);
      } else {
        await pool.query('UPDATE cliente SET nombre=?, telefono=? WHERE idCliente=?', [req.body.nombre, req.body.telefono || null, req.params.id]);
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
crudRoutes('proveedores', 'proveedor', 'idProveedor', 'No se puede eliminar el proveedor porque tiene compras asociadas.');

async function validateItems(connection, items, decreaseStock) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('Debe agregar al menos un producto.');
    error.status = 400;
    throw error;
  }

  const normalized = [];
  for (const item of items) {
    const cantidad = asNumber(item.cantidad);
    if (!item.idProducto || cantidad <= 0) {
      const error = new Error('Cada producto debe tener cantidad mayor a cero.');
      error.status = 400;
      throw error;
    }

    const [rows] = await connection.query('SELECT * FROM producto WHERE idProducto=? FOR UPDATE', [item.idProducto]);
    if (rows.length === 0) {
      const error = new Error('Producto no encontrado.');
      error.status = 404;
      throw error;
    }
    const product = rows[0];
    if (decreaseStock && asNumber(product.stock) < cantidad) {
      const error = new Error(`Stock insuficiente para ${product.nombre}. Disponible: ${product.stock} ${product.unidadMedida}.`);
      error.status = 400;
      throw error;
    }

    const precio = item.precioCompra !== undefined ? asNumber(item.precioCompra) : asNumber(product.precioVenta);
    normalized.push({ product, cantidad, precio, subtotal: cantidad * precio });
  }
  return normalized;
}

router.post('/ventas', async (req, res, next) => {
  try {
    const result = await runTransaction(async (connection) => {
      const items = await validateItems(connection, req.body.items, true);
      const total = items.reduce((sum, item) => sum + item.subtotal, 0);
      const [venta] = await connection.query('INSERT INTO venta (total, idCliente) VALUES (?, ?)', [total, req.body.idCliente || null]);
      for (const item of items) {
        await connection.query('INSERT INTO detalleVenta (idVenta, idProducto, cantidad, precioVenta, subtotal) VALUES (?, ?, ?, ?, ?)', [venta.insertId, item.product.idProducto, item.cantidad, item.precio, item.subtotal]);
        await connection.query('UPDATE producto SET stock = stock - ? WHERE idProducto=?', [item.cantidad, item.product.idProducto]);
      }
      return { idVenta: venta.insertId, total };
    });
    res.status(201).json({ message: 'Venta registrada.', ...result });
  } catch (error) {
    next(error);
  }
});

router.post('/compras', async (req, res, next) => {
  try {
    const result = await runTransaction(async (connection) => {
      const items = await validateItems(connection, req.body.items, false);
      const total = items.reduce((sum, item) => sum + item.subtotal, 0);
      const [compra] = await connection.query('INSERT INTO compra (total, idProveedor) VALUES (?, ?)', [total, req.body.idProveedor || null]);
      for (const item of items) {
        await connection.query('INSERT INTO detalleCompra (idCompra, idProducto, cantidad, precioCompra, subtotal) VALUES (?, ?, ?, ?, ?)', [compra.insertId, item.product.idProducto, item.cantidad, item.precio, item.subtotal]);
        await connection.query('UPDATE producto SET stock = stock + ? WHERE idProducto=?', [item.cantidad, item.product.idProducto]);
      }
      return { idCompra: compra.insertId, total };
    });
    res.status(201).json({ message: 'Compra registrada.', ...result });
  } catch (error) {
    next(error);
  }
});

router.post('/fiados', async (req, res, next) => {
  try {
    if (!req.body.idCliente) return res.status(400).json({ error: 'El fiado debe tener cliente.' });
    const result = await runTransaction(async (connection) => {
      const items = await validateItems(connection, req.body.items, true);
      const total = items.reduce((sum, item) => sum + item.subtotal, 0);
      const [fiado] = await connection.query('INSERT INTO fiado (idCliente, fechaInicio, totalFiado, saldoPendiente, estado) VALUES (?, CURDATE(), ?, ?, ?)', [req.body.idCliente, total, total, 'pendiente']);
      for (const item of items) {
        await connection.query('INSERT INTO detalleFiado (idFiado, idProducto, cantidad, precio, subtotal) VALUES (?, ?, ?, ?, ?)', [fiado.insertId, item.product.idProducto, item.cantidad, item.precio, item.subtotal]);
        await connection.query('UPDATE producto SET stock = stock - ? WHERE idProducto=?', [item.cantidad, item.product.idProducto]);
      }
      return { idFiado: fiado.insertId, totalFiado: total };
    });
    res.status(201).json({ message: 'Fiado registrado.', ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/fiados', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT f.*, c.nombre AS cliente FROM fiado f JOIN cliente c ON c.idCliente=f.idCliente ORDER BY f.idFiado DESC`);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/fiados/activos', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT f.*, c.nombre AS cliente FROM fiado f JOIN cliente c ON c.idCliente=f.idCliente WHERE f.estado IN ('pendiente','parcial') ORDER BY f.idFiado DESC`);
    res.json(rows);
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
      await connection.query('INSERT INTO pagoFiado (idFiado, monto, observacion) VALUES (?, ?, ?)', [req.body.idFiado, monto, req.body.observacion || null]);
      const totalPagado = asNumber(fiado.totalPagado) + monto;
      const saldo = Math.max(0, asNumber(fiado.totalFiado) - totalPagado);
      const estado = saldo === 0 ? 'pagado' : totalPagado > 0 ? 'parcial' : 'pendiente';
      await connection.query('UPDATE fiado SET totalPagado=?, saldoPendiente=?, estado=? WHERE idFiado=?', [totalPagado, saldo, estado, req.body.idFiado]);
    });
    res.status(201).json({ message: 'Pago registrado.' });
  } catch (error) {
    next(error);
  }
});

router.get('/reportes/:tipo', async (req, res, next) => {
  try {
    const { tipo } = req.params;
    const { desde, hasta, idProveedor } = req.query;
    const range = [desde || '1000-01-01', hasta || '9999-12-31'];
    const queries = {
      ventasDia: ['SELECT * FROM venta WHERE DATE(fecha)=CURDATE() ORDER BY fecha DESC', []],
      ventasRango: ['SELECT * FROM venta WHERE DATE(fecha) BETWEEN ? AND ? ORDER BY fecha DESC', range],
      bajoStock: ['SELECT * FROM producto WHERE stock < stockMinimo ORDER BY nombre', []],
      masVendidos: [`SELECT p.nombre, p.unidadMedida, SUM(d.cantidad) cantidadVendida, SUM(d.subtotal) totalVendido FROM detalleVenta d JOIN producto p ON p.idProducto=d.idProducto GROUP BY p.idProducto ORDER BY cantidadVendida DESC LIMIT 20`, []],
      fiadosPendientes: [`SELECT f.*, c.nombre cliente FROM fiado f JOIN cliente c ON c.idCliente=f.idCliente WHERE f.estado='pendiente' ORDER BY f.fechaInicio DESC`, []],
      fiadosParciales: [`SELECT f.*, c.nombre cliente FROM fiado f JOIN cliente c ON c.idCliente=f.idCliente WHERE f.estado='parcial' ORDER BY f.fechaInicio DESC`, []],
      pagosFiado: [`SELECT p.*, c.nombre cliente FROM pagoFiado p JOIN fiado f ON f.idFiado=p.idFiado JOIN cliente c ON c.idCliente=f.idCliente ORDER BY p.fechaPago DESC`, []],
      compras: ['SELECT * FROM compra ORDER BY fecha DESC', []],
      comprasProveedor: [`SELECT co.*, pr.nombre proveedor FROM compra co LEFT JOIN proveedor pr ON pr.idProveedor=co.idProveedor WHERE (? IS NULL OR co.idProveedor=?) ORDER BY co.fecha DESC`, [idProveedor || null, idProveedor || null]]
    };
    if (!queries[tipo]) return res.status(404).json({ error: 'Reporte no encontrado.' });
    const [rows] = await pool.query(queries[tipo][0], queries[tipo][1]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Ocurrio un error.' });
});

module.exports = router;
