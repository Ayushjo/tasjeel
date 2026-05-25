// End-to-end API tests: a supplier registers through the draft API, a reviewer works the case.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { test, as } from './setup.js';

const { GET, POST, PATCH } = test;
const A = '/odata/v4/applicant/Applications';
const R = '/odata/v4/review/Applications';
const draft = (ID) => `${A}(ID=${ID},IsActiveEntity=false)`;
const active = (ID) => `${A}(ID=${ID},IsActiveEntity=true)`;

describe('supplier registration lifecycle', () => {
  let ID;

  it('creates a draft with Saudi defaults', async () => {
    const res = await POST(A, {}, as('vendor2'));
    assert.equal(res.status, 201);
    ID = res.data.ID;
    assert.equal(res.data.IsActiveEntity, false);
    assert.equal(res.data.status_code, 'DRAFT');
    assert.equal(res.data.country_code, 'SA');
    assert.equal(res.data.paymentCurrency_code, 'SAR');
  });

  it('autosave normalizes identifiers and detects the bank from the IBAN', async () => {
    const res = await PATCH(draft(ID), { unifiedNo: '٧٠٥٥٥٥٥٥٥٥', iban: 'sa03 8000 0000 6080 1016 7519' }, as('vendor2'));
    assert.equal(res.status, 200);
    assert.equal(res.data.unifiedNo, '7055555555');
    assert.equal(res.data.iban, 'SA0380000000608010167519');
    assert.equal(res.data.bankCode_code, '80');
    assert.equal(res.data.swift, 'RJHISARI');
  });

  it('requirements() lists what is still missing, by wizard step', async () => {
    const res = await GET(`${draft(ID)}/ApplicantService.requirements()`, as('vendor2'));
    assert.equal(res.status, 200);
    assert.equal(res.data.complete, false);
    const steps = new Set(res.data.items.map((i) => i.step));
    // tax + document rules depend on the supplier type, which isn't chosen yet
    for (const s of ['pre', 'address', 'banking', 'products', 'declarations']) assert.ok(steps.has(s), `missing step ${s}`);
    assert.ok(res.data.items.every((i) => i.message && i.message !== i.code), 'messages are translated');
  });

  it('activation is blocked with field-level errors (in Arabic when asked)', async () => {
    const res = await POST(`${draft(ID)}/ApplicantService.draftActivate`, {}, { ...as('vendor2'), headers: { 'Accept-Language': 'ar' } });
    assert.equal(res.status, 400);
    const details = res.data.error.details ?? [res.data.error];
    const targets = details.map((d) => d.target);
    assert.ok(targets.includes('legalNameEn'), 'targets the field');
    assert.ok(details.some((d) => /الحقل مطلوب/.test(d.message)), 'Arabic message');
  });

  it('a completed draft activates', async () => {
    await PATCH(draft(ID), {
      supplierType_code: 'LOCAL', legalForm_code: 'LLC',
      legalNameEn: 'Ofuq Engineering Co.', legalNameAr: 'شركة أفق للهندسة',
      city: 'Riyadh', district: 'Al Wadi', street: 'Olaya St', buildingNo: '8228', postalCode: '12212', additionalNo: '1234',
      vatNumber: '310987654300003', zakatCertNo: 'ZK-123456', gosiNo: '512345678',
      accountHolder: 'OFUQ ENGINEERING', declarationAccepted: true, declaredBy: 'Faisal Al-Harbi',
    }, as('vendor2'));
    await POST(`${draft(ID)}/contacts`, { name: 'Faisal Al-Harbi', email: 'gm@ofuq.sa', phone: '+966501234567', isPrimary: true, isSignatory: true }, as('vendor2'));
    await POST(`${draft(ID)}/categories`, { category_code: 'CONSTRUCTION' }, as('vendor2'));
    for (const code of ['UNIFIED_CR', 'VAT_CERT', 'ZAKAT_CERT', 'GOSI_CERT', 'CHAMBER_CERT', 'IBAN_LETTER'])
      await POST(`${draft(ID)}/documents`, { docType_code: code, fileName: `${code}.pdf`, mediaType: 'application/pdf', size: 1000 }, as('vendor2'));

    const res = await POST(`${draft(ID)}/ApplicantService.draftActivate`, {}, as('vendor2'));
    assert.equal(res.status, 201, JSON.stringify(res.data?.error));
    assert.equal(res.data.IsActiveEntity, true);
    assert.ok(res.data.declaredAt);
  });

  it('submit assigns the next application number and a risk score', async () => {
    const res = await POST(`${active(ID)}/ApplicantService.submit`, {}, as('vendor2'));
    assert.equal(res.status, 200, JSON.stringify(res.data?.error));
    assert.equal(res.data.status_code, 'SUBMITTED');
    assert.match(res.data.applicationNo, /^TSJ-2026-\d{6}$/);
    assert.equal(res.data.version, 1);
  });

  it('the application is locked while submitted', async () => {
    const res = await POST(`${active(ID)}/ApplicantService.draftEdit`, { PreserveChanges: true }, as('vendor2'));
    assert.equal(res.status, 409);
  });

  it('suppliers cannot see each other', async () => {
    const res = await GET(active(ID), as('vendor1'));
    assert.ok([403, 404].includes(res.status), `got ${res.status}`);
  });

  it('suppliers cannot use the reviewer API', async () => {
    const res = await GET(R, as('vendor2'));
    assert.equal(res.status, 403);
  });

  it('reviewer: reject needs a real reason', async () => {
    const res = await POST(`${R}(${ID})/ReviewService.rejectApplication`, { reason: 'no' }, as('reviewer'));
    assert.equal(res.status, 400);
  });

  it('reviewer: start review, then request changes with flagged fields', async () => {
    let res = await POST(`${R}(${ID})/ReviewService.startReview`, {}, as('reviewer'));
    assert.equal(res.status, 200);
    assert.equal(res.data.status_code, 'IN_REVIEW');
    res = await POST(`${R}(${ID})/ReviewService.requestChanges`, { note: 'Please upload a valid GOSI certificate.', fields: ['gosiNo'] }, as('reviewer'));
    assert.equal(res.status, 200);
    assert.equal(res.data.status_code, 'CHANGES_REQUESTED');
  });

  it('supplier sees the shared comment and the flag, edits and resubmits as version 2', async () => {
    const comments = await GET(`/odata/v4/applicant/Comments?$filter=application_ID eq ${ID}`, as('vendor2'));
    assert.equal(comments.data.value.length, 1);
    const flags = await GET(`/odata/v4/applicant/ReviewFlags?$filter=application_ID eq ${ID}`, as('vendor2'));
    assert.equal(flags.data.value[0].field, 'gosiNo');

    let res = await POST(`${active(ID)}/ApplicantService.draftEdit`, { PreserveChanges: true }, as('vendor2'));
    assert.ok([200, 201].includes(res.status), JSON.stringify(res.data?.error));
    await PATCH(draft(ID), { gosiNo: '598765432' }, as('vendor2'));
    res = await POST(`${draft(ID)}/ApplicantService.draftActivate`, {}, as('vendor2'));
    assert.ok([200, 201].includes(res.status), JSON.stringify(res.data?.error));
    res = await POST(`${active(ID)}/ApplicantService.submit`, {}, as('vendor2'));
    assert.equal(res.status, 200, JSON.stringify(res.data?.error));
    assert.equal(res.data.version, 2);
  });

  it('reviewer approves; the supplier is created in S/4 and appears in the admin vendor list', async () => {
    await POST(`${R}(${ID})/ReviewService.startReview`, {}, as('reviewer'));
    const res = await POST(`${R}(${ID})/ReviewService.approve`, { note: 'All documents verified.' }, as('reviewer'));
    assert.equal(res.status, 200);
    assert.equal(res.data.status_code, 'REGISTERED');
    assert.equal(res.data.s4SyncStatus, 'SYNCED');
    assert.match(res.data.s4BusinessPartner, /^\d{7}$/);
    const vendors = await GET(`/odata/v4/admin/Vendors?$filter=ID eq ${ID}`, as('admin'));
    assert.equal(vendors.data.value.length, 1);
  });

  it('history records every transition', async () => {
    const res = await GET(`/odata/v4/review/StatusHistory?$filter=application_ID eq ${ID}&$orderby=createdAt`, as('reviewer'));
    assert.deepEqual(res.data.value.map((h) => h.toStatus), ['SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REGISTERED']);
  });

  it('approved applications can no longer be changed', async () => {
    const res = await POST(`${R}(${ID})/ReviewService.requestChanges`, { note: 'Too late to change anything now.' }, as('reviewer'));
    assert.equal(res.status, 409);
  });
});

describe('dashboard stats (REST)', () => {
  it('summary and breakdowns', async () => {
    const s = await GET('/rest/stats/summary', as('reviewer'));
    assert.equal(s.status, 200);
    assert.ok(s.data.awaitingReview >= 1);
    const w = await GET('/rest/stats/weekly?weeks=8', as('reviewer'));
    assert.equal(w.data.length, 8);
    const c = await GET('/rest/stats/byCategory', { ...as('reviewer'), headers: { 'Accept-Language': 'ar' } });
    assert.ok(c.data.some((r) => r.name === 'المقاولات'));
  });
});

describe('reviewer insights', () => {
  const NAJD = '8293e5d9-aeca-fbcd-9ab4-ca1669f8e977';

  it('riskBreakdown explains the stored score with localized factors', async () => {
    const res = await GET(`${R}(${NAJD})/ReviewService.riskBreakdown()`, { ...as('reviewer'), headers: { 'Accept-Language': 'ar' } });
    assert.equal(res.status, 200);
    const app = await GET(`${R}(${NAJD})?$select=riskScore,riskLevel`, as('reviewer'));
    assert.equal(res.data.score, app.data.riskScore, 'live breakdown matches stored score');
    assert.equal(res.data.level, app.data.riskLevel);
    assert.ok(res.data.factors.length > 0 && res.data.factors.every((f) => /[؀-ۿ]/.test(f.label)), 'Arabic factor labels');
  });

  it('duplicate IBAN is detected across suppliers', async () => {
    const q = await GET(`${R}?$filter=legalNameEn eq 'Gulf Medical Supplies Est.'&$select=ID`, as('reviewer'));
    const id = q.data.value[0].ID;
    const res = await GET(`${R}(${id})/ReviewService.duplicates()`, as('reviewer'));
    assert.ok(res.data.value.some((d) => d.matchedOn === 'iban'));
  });

  it('Vendors (Fiori Elements) lists only approved or registered suppliers', async () => {
    const res = await GET('/odata/v4/review/Vendors?$expand=status', as('reviewer'));
    assert.ok(res.data.value.length > 0);
    assert.ok(res.data.value.every((v) => ['APPROVED', 'REGISTERED'].includes(v.status.code)));
  });

  it('suppliers cannot read the vendor list', async () => {
    const res = await GET('/odata/v4/review/Vendors', as('vendor1'));
    assert.equal(res.status, 403);
  });
});
