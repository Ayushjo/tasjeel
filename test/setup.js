// Shared test server: hermetic S/4 setup.
//  - API_BUSINESS_PARTNER (target S/4) has no credentials -> served in-process as a mock (srv/external/API_BUSINESS_PARTNER.js)
//  - S4_SANDBOX points at a closed port -> exercises the "unreachable" path, never calls api.sap.com
import cds from '@sap/cds';

const root = import.meta.dirname + '/..';
cds.test.in(root);
delete cds.env.requires.API_BUSINESS_PARTNER.credentials;
cds.env.requires.S4_SANDBOX.credentials = { url: 'http://127.0.0.1:9/sap/opu/odata/sap/API_BUSINESS_PARTNER' };

export const test = cds.test('serve', 'all', '--with-mocks', '--in-memory');
test.axios.defaults.validateStatus = () => true; // assert on status codes ourselves
export const as = (username) => ({ auth: { username, password: '' } });
