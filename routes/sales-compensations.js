const express = require('express');
const { COMPENSATION_FEATURE } = require('../config/compensation-contract');
const { requirePlanFeature } = require('../middleware/subscription');
const { compensateSale } = require('../services/sale-compensation-service');

const router = express.Router();

router.post(
  '/ventas/:idVenta/compensaciones',
  requirePlanFeature(COMPENSATION_FEATURE),
  async (req, res, next) => {
    try {
      const result = await compensateSale({
        idTienda: req.tenant.idTienda,
        idAdministrador: req.auth.idAdministrador,
        requestId: req.requestId,
        idVenta: req.params.idVenta,
        body: req.body
      });
      res.status(result.repetida ? 200 : 201).json({
        message: result.repetida
          ? 'La compensacion ya habia sido aplicada.'
          : 'Compensacion de venta aplicada.',
        ...result
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
