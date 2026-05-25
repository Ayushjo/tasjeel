// Completeness + format rules for an application, in one place.
// Used by: draft activation (blocking errors), the "What's still needed" panel (requirements()),
// and the reviewer's view. Each finding names the wizard step so the UI can jump there.
import * as v from './validators.js';
import { missingDocuments } from './workflow.js';

/** Wizard steps (ids match the UI5 routes). */
export const STEP = { PRE: 'pre', PROFILE: 'profile', ADDRESS: 'address', TAX: 'tax', BANK: 'banking', PRODUCTS: 'products', DOCS: 'documents', DECLARE: 'declarations' };

const blank = (x) => x == null || String(x).trim() === '';

/**
 * @returns {Array<{ field: string, code: string, step: string, args?: any[], severity: 'error'|'warning' }>}
 *   code = i18n message key in _i18n/messages*.properties
 */
export function checkApplication(app, { docTypes = [] } = {}) {
  const out = [];
  const err = (field, code, step, args) => out.push({ field, code, step, args, severity: 'error' });
  const warn = (field, code, step, args) => out.push({ field, code, step, args, severity: 'warning' });
  const required = (field, step) => blank(app[field]) && err(field, 'REQUIRED', step);
  const type = app.supplierType_code;
  const country = app.country_code;

  // Pre-registration / profile
  required('supplierType_code', STEP.PRE);
  required('legalNameEn', STEP.PRE);
  required('legalNameAr', STEP.PRE);
  if (!blank(app.legalNameAr) && !v.hasArabicLetters(app.legalNameAr)) warn('legalNameAr', 'NAME_AR_SCRIPT', STEP.PRE);
  required('legalForm_code', STEP.PROFILE);

  if (type === 'LOCAL') {
    if (blank(app.unifiedNo)) err('unifiedNo', 'REQUIRED', STEP.PRE);
    else if (!v.isUnifiedNo(app.unifiedNo)) err('unifiedNo', 'UNIFIED_NO_FORMAT', STEP.PRE);
  }
  if (!blank(app.legacyCrNo) && !v.isLegacyCr(app.legacyCrNo)) err('legacyCrNo', 'LEGACY_CR_FORMAT', STEP.PROFILE);
  if (type === 'FOREIGN') required('misaLicenseNo', STEP.PROFILE);
  if (app.establishedOn && new Date(app.establishedOn) > new Date()) err('establishedOn', 'DATE_IN_FUTURE', STEP.PROFILE);

  // Address
  required('country_code', STEP.ADDRESS);
  required('city', STEP.ADDRESS);
  if (country === 'SA') {
    required('district', STEP.ADDRESS);
    required('street', STEP.ADDRESS);
    if (blank(app.buildingNo)) err('buildingNo', 'REQUIRED', STEP.ADDRESS);
    else if (!v.isBuildingNo(app.buildingNo)) err('buildingNo', 'FOUR_DIGITS', STEP.ADDRESS);
    if (blank(app.postalCode)) err('postalCode', 'REQUIRED', STEP.ADDRESS);
    else if (!v.isSaudiPostalCode(app.postalCode)) err('postalCode', 'POSTAL_CODE_FORMAT', STEP.ADDRESS);
    if (blank(app.additionalNo)) err('additionalNo', 'REQUIRED', STEP.ADDRESS);
    else if (!v.isAdditionalNo(app.additionalNo)) err('additionalNo', 'FOUR_DIGITS', STEP.ADDRESS);
    if (!blank(app.shortAddress) && !v.isShortAddress(app.shortAddress)) err('shortAddress', 'SHORT_ADDRESS_FORMAT', STEP.ADDRESS);
  }

  const contacts = app.contacts || [];
  if (!contacts.length) err('contacts', 'CONTACT_REQUIRED', STEP.ADDRESS);
  else {
    if (contacts.filter((c) => c.isPrimary).length !== 1) err('contacts', 'ONE_PRIMARY_CONTACT', STEP.ADDRESS);
    if (!contacts.some((c) => c.isSignatory)) err('contacts', 'SIGNATORY_REQUIRED', STEP.ADDRESS);
    contacts.forEach((c) => {
      const f = (name) => `contacts(ID=${c.ID},IsActiveEntity=false)/${name}`;
      if (blank(c.name)) err(f('name'), 'REQUIRED', STEP.ADDRESS);
      if (blank(c.email)) err(f('email'), 'REQUIRED', STEP.ADDRESS);
      else if (!v.isEmail(c.email)) err(f('email'), 'EMAIL_FORMAT', STEP.ADDRESS);
      if (!blank(c.phone) && !v.isE164(c.phone)) err(f('phone'), 'PHONE_FORMAT', STEP.ADDRESS);
    });
  }

  // Tax & compliance
  if (type === 'LOCAL') {
    if (blank(app.vatNumber) && blank(app.vatExemptReason)) err('vatNumber', 'VAT_OR_REASON', STEP.TAX);
    if (!blank(app.vatNumber) && !v.isKsaVat(app.vatNumber)) err('vatNumber', 'VAT_FORMAT', STEP.TAX);
    required('zakatCertNo', STEP.TAX);
    required('gosiNo', STEP.TAX);
  }
  if (country === 'AE' && !blank(app.vatNumber) && !v.isUaeTrn(app.vatNumber)) err('vatNumber', 'TRN_FORMAT', STEP.TAX);

  // Banking
  const sar = (app.paymentCurrency_code || 'SAR') === 'SAR';
  if (blank(app.iban)) err('iban', 'REQUIRED', STEP.BANK);
  else if (sar ? !v.isSaudiIban(app.iban) : !v.isIban(app.iban)) err('iban', sar ? 'IBAN_SA_FORMAT' : 'IBAN_FORMAT', STEP.BANK);
  if (!sar) {
    if (blank(app.swift)) err('swift', 'REQUIRED', STEP.BANK);
    else if (!v.isSwift(app.swift)) err('swift', 'SWIFT_FORMAT', STEP.BANK);
  }
  if (blank(app.accountHolder)) err('accountHolder', 'REQUIRED', STEP.BANK);
  else if (!blank(app.legalNameEn) && !v.namesMatch(app.accountHolder, app.legalNameEn) && !v.namesMatch(app.accountHolder, app.legalNameAr))
    err('accountHolder', 'HOLDER_MISMATCH', STEP.BANK, [app.legalNameEn]);

  // Products
  if (!(app.categories || []).length) err('categories', 'CATEGORY_REQUIRED', STEP.PRODUCTS);

  // Documents
  const docName = (code) => docTypes.find((t) => t.code === code)?.name || code;
  for (const code of missingDocuments(app, docTypes)) err('documents', 'DOCUMENT_MISSING', STEP.DOCS, [docName(code)]);
  const today = new Date().toISOString().slice(0, 10);
  for (const d of app.documents || []) {
    if (d.expiryDate && d.expiryDate < today) err(`documents(ID=${d.ID},IsActiveEntity=false)/expiryDate`, 'DOCUMENT_EXPIRED', STEP.DOCS, [docName(d.docType_code)]);
  }

  // Declarations
  if (!app.declarationAccepted) err('declarationAccepted', 'DECLARATION_REQUIRED', STEP.DECLARE);
  if (app.declarationAccepted) required('declaredBy', STEP.DECLARE);

  return out;
}

/** Normalize identifiers in place (Arabic-Indic digits, spaces, dashes) before they are stored. */
export function normalizeIdentifiers(data) {
  for (const f of ['unifiedNo', 'legacyCrNo', 'vatNumber', 'gosiNo', 'buildingNo', 'postalCode', 'additionalNo', 'shortAddress', 'iban', 'swift']) {
    if (typeof data[f] === 'string') data[f] = v.compact(data[f]);
  }
  if (typeof data.zakatCertNo === 'string') data.zakatCertNo = v.normalizeDigits(data.zakatCertNo).trim();
  if (typeof data.phone === 'string') data.phone = v.compact(data.phone);
  return data;
}
