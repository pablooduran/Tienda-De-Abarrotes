const express = require('express');
const { publicSubscriptionSummary } = require('../services/subscription-access-service');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(publicSubscriptionSummary(req.subscriptionContext));
});

module.exports = router;
