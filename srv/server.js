// Local development only: the UI apps call the backend with URLs *relative* to their own folder, so the same build
// works behind the approuter (HTML5 repository → app xs-app.json → backend destination) and in SAP Build Work Zone.
//
// When CAP serves app/<name>/webapp/ itself, relative OData calls are already redirected by @sap/cds-fiori
// (it reads the manifests' dataSources). This adds the same for the REST endpoints, and serves the vendors app's
// shared stylesheet and icon font from the portal. In production none of these paths reach this server.
import cds from '@sap/cds';

const REST = /^\/(?:portal|vendors)\/webapp(?=\/rest\/)/;
const SHARED = /^\/vendors\/webapp\/(css|fonts)\//;

cds.on('bootstrap', (app) => {
  app.use((req, _res, next) => {
    if (REST.test(req.url)) req.url = req.originalUrl = req.url.replace(REST, '');
    else if (SHARED.test(req.url)) req.url = req.originalUrl = req.url.replace(SHARED, '/portal/webapp/$1/');
    next();
  });
});

export default cds.server;
