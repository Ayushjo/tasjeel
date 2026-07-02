// S/4HANA integration: duplicate check, Business Partner creation, failure + retry, idempotency.
import cds from '@sap/cds';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { test, as } from './setup.js';
import { nameTokens, splitName, withTimeout } from '../srv/lib/s4.js';

const { GET, POST } = test;
const R = '/odata/v4/review/Applications';
const idOf = async (applicationNo) => (await GET(`${R}?$filter=applicationNo eq '${applicationNo}'&$select=ID`, as('reviewer'))).data.value[0].ID;
const approve = (ID) => POST(`${R}(${ID})/ReviewService.approve`, { note: 'Checked.' }, as('reviewer'));
const retry = (ID) => POST(`${R}(${ID})/ReviewService.retrySync`, {}, as('reviewer'));

describe('S/4 helpers', () => {
  it('search words: brand word plus the longest distinctive word', () => {
    assert.deepEqual(nameTokens('Najd Facilities Services Co.'), ['Najd']);
    assert.deepEqual(nameTokens('Al Waha Logistics'), ['Waha'], 'industry words are not distinctive');
    assert.deepEqual(nameTokens('Tamkeen Digital Integration LLC'), ['Tamkeen', 'Integration']);
    assert.deepEqual(nameTokens('The Saudi Trading Company'), []);
  });

  it('splits long names into the two 40-character BP name fields at a word boundary', () => {
    const [a, b] = splitName('Al Rajhi Integrated Industrial Services and Maintenance Company');
    assert.ok(a.length <= 40 && b.length <= 40);
    assert.equal(`${a} ${b}`, 'Al Rajhi Integrated Industrial Services and Maintenance Company');
  });

  it('times out slow calls', async () => {
    await assert.rejects(withTimeout(new Promise(() => {}), 20), { code: 'S4_TIMEOUT' });
  });
});

describe('S/4HANA integration', () => {
  afterEach(() => { globalThis.MOCK_S4_OUTAGE = false; });

  it('duplicate check reports each system, and an unreachable sandbox is not an error', async () => {
    const res = await GET(`${R}(${await idOf('TSJ-2026-000418')})/ReviewService.s4Check(fresh=true)`, as('reviewer'));
    assert.equal(res.status, 200);
    const [target, sandbox] = res.data.systems;
    assert.equal(target.system, 'API_BUSINESS_PARTNER');
    assert.equal(target.reachable, true);
    assert.equal(target.query, 'Najd');
    assert.equal(sandbox.reachable, false);
    assert.ok(sandbox.error);
  });

  it('approve during an S/4 outage keeps the approval and records the failure; retry registers', async () => {
    const ID = await idOf('TSJ-2026-000412');
    globalThis.MOCK_S4_OUTAGE = true;
    let res = await approve(ID);
    assert.equal(res.status, 200);
    assert.equal(res.data.status_code, 'APPROVED');
    assert.equal(res.data.s4SyncStatus, 'FAILED');
    assert.match(res.data.s4SyncMessage, /unavailable/);
    assert.equal(res.data.s4SyncAttempts, 1);

    globalThis.MOCK_S4_OUTAGE = false;
    res = await retry(ID);
    assert.equal(res.data.status_code, 'REGISTERED', JSON.stringify(res.data));
    assert.equal(res.data.s4SyncStatus, 'SYNCED');
    assert.equal(res.data.s4SyncAttempts, 2);
    const bp = res.data.s4BusinessPartner;

    const s4 = await cds.connect.to('API_BUSINESS_PARTNER');
    const created = await s4.run(SELECT.one.from('API_BUSINESS_PARTNER.A_BusinessPartner').where({ BusinessPartner: bp }));
    assert.equal(created.SearchTerm2, 'TSJ-2026-000412');
    assert.equal(created.BusinessPartnerCategory, '2');
    const tax = await s4.run(SELECT.from('API_BUSINESS_PARTNER.A_BusinessPartnerTaxNumber').where({ BusinessPartner: bp }));
    assert.equal(tax.length, 1, 'VAT number stored');

    assert.equal((await retry(ID)).status, 409, 'a synced application cannot be retried');
  });

  it('retry is idempotent: a BP created by a lost earlier call is adopted, not duplicated', async () => {
    const ID = await idOf('TSJ-2026-000409');
    globalThis.MOCK_S4_OUTAGE = true;
    await approve(ID);
    globalThis.MOCK_S4_OUTAGE = false;
    // Simulate: the first POST reached S/4, but its response never came back
    const s4 = await cds.connect.to('API_BUSINESS_PARTNER');
    await s4.run(INSERT.into('API_BUSINESS_PARTNER.A_BusinessPartner').entries({ BusinessPartner: '1000999', OrganizationBPName1: 'Sahara Build Contracting', SearchTerm2: 'TSJ-2026-000409' }));
    const res = await retry(ID);
    assert.equal(res.data.s4BusinessPartner, '1000999');
    assert.equal(res.data.status_code, 'REGISTERED');
    const all = await s4.run(SELECT.from('API_BUSINESS_PARTNER.A_BusinessPartner').where({ SearchTerm2: 'TSJ-2026-000409' }));
    assert.equal(all.length, 1);
  });
});
