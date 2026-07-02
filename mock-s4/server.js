// Mock S/4 extras: an outage switch so the retry path can be demoed from the UI.
//   POST /mock/outage {"on": true|false}   GET /mock/outage
import cds from '@sap/cds';
import express from 'express';

cds.on('bootstrap', (app) => {
  app.use('/mock/outage', express.json());
  app.get('/mock/outage', (_req, res) => res.json({ on: !!globalThis.MOCK_S4_OUTAGE }));
  app.post('/mock/outage', (req, res) => {
    globalThis.MOCK_S4_OUTAGE = req.body?.on !== false;
    res.json({ on: globalThis.MOCK_S4_OUTAGE });
  });
});

export default cds.server;
