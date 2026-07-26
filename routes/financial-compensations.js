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
const {
  compensationOptions,
  listCompensations,
  operationDetail,
  pendingCompensations,
  saleContext
} = require('../services/compensation-query-service');
const { buildCompensationExport } = require('../services/compensation-export-service');
const pool = require('../config/db');

const router = express.Router();

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

function requireExportSubscription(req, res, next) {
  if (req.subscriptionContext && !req.subscriptionContext.soloLectura) return next();
  return res.status(403).json({
    error: 'La suscripcion debe estar activa para generar exportaciones.',
    code: 'SUBSCRIPTION_READ_ONLY',
    estadoSuscripcion: req.subscriptionContext?.suscripcion?.estadoEfectivo || 'sin_suscripcion'
  });
}

function compensationRead(handler) {
  return [
    requirePlanFeature(COMPENSATION_FEATURE),
    async (req, res, next) => {
      try {
        noStore(res);
        res.json(await handler(req));
      } catch (error) {
        next(error);
      }
    }
  ];
}

function compensationInput(req) {
  return {
    idTienda: req.tenant.idTienda,
    idAdministrador: req.auth.idAdministrador,
    requestId: req.requestId,
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

router.get(
  '/compensaciones',
  ...compensationRead((req) => listCompensations(pool, req.tenant.idTienda, req.query))
);

router.get(
  '/compensaciones/opciones',
  ...compensationRead((req) => compensationOptions(pool, req.tenant.idTienda))
);

router.get(
  '/compensaciones/pendientes',
  ...compensationRead((req) => pendingCompensations(pool, req.tenant.idTienda))
);

router.get(
  '/compensaciones/ventas/:idVenta/contexto',
  ...compensationRead((req) => saleContext(pool, req.tenant.idTienda, req.params.idVenta))
);

router.get(
  '/compensaciones/exportaciones/:tipo.:formato',
  requirePlanFeature(COMPENSATION_FEATURE),
  requirePlanFeature('exportacion_reportes'),
  requireExportSubscription,
  async (req, res, next) => {
    try {
      const result = await buildCompensationExport(
        pool,
        req.tenant.idTienda,
        req.params.tipo,
        req.params.formato,
        req.query
      );
      noStore(res);
      res.set('Content-Type', result.contentType);
      res.set('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/compensaciones/:id',
  ...compensationRead((req) => operationDetail(pool, req.tenant.idTienda, req.params.id))
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
      noStore(res);
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
