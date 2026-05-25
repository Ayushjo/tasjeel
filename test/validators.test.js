import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../srv/lib/validators.js';
import { canTransition, missingDocuments, assessRisk } from '../srv/lib/workflow.js';

test('Arabic-Indic digits are normalized before validation', () => {
  assert.equal(v.normalizeDigits('٧٠١٢٣٤٥٦٧٨'), '7012345678');
  assert.equal(v.normalizeDigits('۳۱۰'), '310');
  assert.ok(v.isUnifiedNo('٧٠١٢٣٤٥٦٧٨'));
});

test('unified number: 10 digits starting with 7', () => {
  assert.ok(v.isUnifiedNo('7012345678'));
  assert.ok(!v.isUnifiedNo('1012345678'));
  assert.ok(!v.isUnifiedNo('701234567'));
});

test('KSA VAT: 15 digits, starts and ends with 3', () => {
  assert.ok(v.isKsaVat('310123456700003'));
  assert.ok(v.isKsaVat('310 1234 5670 0003'));
  assert.ok(!v.isKsaVat('310123456700001'));
  assert.ok(!v.isKsaVat('31012345670000'));
});

test('IBAN: mod-97, Saudi format and bank detection', () => {
  const iban = 'SA03 8000 0000 6080 1016 7519';
  assert.ok(v.isIban(iban));
  assert.ok(v.isSaudiIban(iban));
  assert.equal(v.bankCodeFromIban(iban), '80');
  assert.equal(v.formatIban('sa0380000000608010167519'), 'SA03 8000 0000 6080 1016 7519');
  assert.ok(!v.isSaudiIban('SA04 8000 0000 6080 1016 7519'), 'wrong check digits');
  assert.ok(v.isIban('GB82 WEST 1234 5698 7654 32'));
  assert.ok(!v.isSaudiIban('GB82 WEST 1234 5698 7654 32'));
});

test('national address parts', () => {
  assert.ok(v.isBuildingNo('8228'));
  assert.ok(!v.isBuildingNo('822'));
  assert.ok(v.isSaudiPostalCode('12212'));
  assert.ok(v.isShortAddress('ragi2929'));
  assert.ok(!v.isShortAddress('RAG2929'));
});

test('contacts: E.164 phone and email', () => {
  assert.ok(v.isE164('+966 50 123 4567'));
  assert.ok(!v.isE164('0501234567'));
  assert.ok(v.isEmail('gm@najd.sa'));
  assert.ok(!v.isEmail('gm@najd'));
});

test('account holder matching ignores case, punctuation and company suffixes', () => {
  assert.ok(v.namesMatch('NAJD FACILITIES SERVICES CO.', 'Najd Facilities Services Co.'));
  assert.ok(v.namesMatch('Najd Facilities Services', 'Najd Facilities Services Co.'));
  assert.ok(!v.namesMatch('Najd Facilities Co.', 'Najd Facilities Services Co.'));
});

test('workflow transitions', () => {
  assert.ok(canTransition('DRAFT', 'SUBMITTED'));
  assert.ok(canTransition('IN_REVIEW', 'CHANGES_REQUESTED'));
  assert.ok(canTransition('CHANGES_REQUESTED', 'SUBMITTED'));
  assert.ok(!canTransition('DRAFT', 'APPROVED'));
  assert.ok(!canTransition('REJECTED', 'SUBMITTED'));
});

test('required documents depend on supplier type', () => {
  const types = [
    { code: 'UNIFIED_CR', requiredFor: 'LOCAL' },
    { code: 'IBAN_LETTER', requiredFor: 'LOCAL,GCC,FOREIGN' },
    { code: 'MISA_LICENSE', requiredFor: 'FOREIGN' },
  ];
  assert.deepEqual(missingDocuments({ supplierType_code: 'LOCAL', documents: [{ docType_code: 'IBAN_LETTER', fileName: 'x.pdf' }] }, types), ['UNIFIED_CR']);
  assert.deepEqual(missingDocuments({ supplierType_code: 'FOREIGN', documents: [] }, types), ['IBAN_LETTER', 'MISA_LICENSE']);
});

test('risk score is explainable and capped', () => {
  const r = assessRisk({ supplierType_code: 'FOREIGN', establishedOn: new Date().toISOString().slice(0, 10) }, { duplicates: [{}] });
  assert.equal(r.level, 'High');
  assert.deepEqual(r.factors.map((f) => f.code).sort(), ['FOREIGN_ENTITY', 'NO_WEBSITE', 'POSSIBLE_DUPLICATE', 'YOUNG_COMPANY']);
  assert.ok(r.score <= 100);
});
