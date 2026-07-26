const express = require('express');
const { COMPENSATION_FEATURE } = require('../config/compensation-contract');
const { requirePlanFeature } = require('../middleware/subscription');
const {
  compensateDebtCollection,
  correctSalePaymentMethod,
  resolveSaleSettlement
} = require('../services/financial-compensation-service');
const { settleRefundObligation } = require('../services/material-settlement-service');
const {
  collectionCompensationReceipt,
  materialSettlementReceipt,
  paymentCorrectionReceipt,
  saleCompensationReceipt
} = require('../services/compensation-receipt-service');
const pool = require('../config/db');

const router = express.Router();

function compensationInput(req) {
  return {
    idTienda: req.tenant.idTienda,
    idAdministrador: req.auth.idAdministrador,
    body: req.body
  };
}

router.post(
  '/liquidaciones-compensacion/:idLiquidacion/resolver',
  requirePlanFeature(COMPENSATION_FEATURE),
  async (req, res, next) => {
    try {
      const result = await resolveSaleSettlement({
        ...compensationInput(req),
        idLiquidacionCompensacionVenta: req.params.idLiquidacion
      });
      res.status(result.repetida ? 200 : 201).json({
        message: result.repetida
          ? 'La liquidacion ya habia sido resuelta.'
          : 'Liquidacion compensatoria resuelta.',
        ...result
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/cobros-fiado/:idCobro/compensaciones',
  requirePlanFeature(COMPENSATION_FEATURE),
  async (req, res, next) => {
    try {
      const result = await compensateDebtCollection({
        ...compensationInput(req),
        idCobroFiado: req.params.idCobro
      });
      res.status(result.repetida ? 200 : 201).json({
        message: result.repetida
          ? 'La compensacion del cobro ya habia sido aplicada.'
          : 'Compensacion del cobro aplicada.',
        ...result
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/pagos-venta/:idPagoVenta/compensaciones/metodo',
  requirePlanFeature(COMPENSATION_FEATURE),
  async (req, res, next) => {
    try {
      const result = await correctSalePaymentMethod({
        ...compensationInput(req),
        idPagoVenta: req.params.idPagoVenta
      });
      res.status(result.repetida ? 200 : 201).json({
        message: result.repetida
          ? 'La correccion del pago ya habia sido registrada.'
          : 'Correccion compensatoria del metodo de pago registrada.',
        ...result
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/obligaciones-reembolso/:idObligacion/liquidaciones',
  requirePlanFeature(COMPENSATION_FEATURE),
  async (req, res, next) => {
    try {
      const result = await settleRefundObligation({
        ...compensationInput(req),
        idObligacionReembolsoVenta: req.params.idObligacion
      });
      res.status(result.repetida ? 200 : 201).json({
        message: result.repetida
          ? 'La liquidacion material ya habia sido registrada.'
          : 'Liquidacion material registrada.',
        ...result
      });
    } catch (error) {
      next(error);
    }
  }
);

function receiptRoute(loader) {
  return async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await loader(pool, req.tenant.idTienda, req.params.id));
    } catch (error) {
      next(error);
    }
  };
}

router.get(
  '/compensaciones/ventas/:id/comprobante',
  requirePlanFeature(COMPENSATION_FEATURE),
  receiptRoute(saleCompensationReceipt)
);

router.get(
  '/compensaciones/liquidaciones/:id/comprobante',
  requirePlanFeature(COMPENSATION_FEATURE),
  receiptRoute(materialSettlementReceipt)
);

router.get(
  '/compensaciones/cobros/:id/comprobante',
  requirePlanFeature(COMPENSATION_FEATURE),
  receiptRoute(collectionCompensationReceipt)
);

router.get(
  '/compensaciones/pagos/:id/comprobante',
  requirePlanFeature(COMPENSATION_FEATURE),
  receiptRoute(paymentCorrectionReceipt)
);

module.exports = router;
