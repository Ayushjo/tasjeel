// S/4HANA integration: duplicate check against the S/4HANA Cloud sandbox (read) and
// Business Partner creation in the target S/4 system (write, on-prem via Cloud Connector in prod).
//
// Both are remote OData V2 services declared in package.json > cds.requires:
//   S4_SANDBOX            api.sap.com sandbox, APIKey header (dev) / destination S4_SANDBOX (prod)
//   API_BUSINESS_PARTNER  mock-s4 on :4006 (dev) / destination S4_ONPREM (prod)
import cds from '@sap/cds';

const LOG = cds.log('s4');
export const TIMEOUT_MS = 5000;
const CACHE_MS = 10 * 60 * 1000;

/** Saudi VAT registration number category in S/4 (BPTaxType). */
const VAT_TAX_TYPE = 'SA1';

/** Words too common in company names to say anything about a match. */
const STOPWORDS = new Set(['company', 'co', 'est', 'establishment', 'llc', 'ltd', 'limited', 'trading', 'group', 'the', 'and',
  'for', 'of', 'saudi', 'arabia', 'arabian', 'services', 'service', 'international', 'contracting', 'inc', 'plc', 'gmbh',
  // industry words: two suppliers in the same trade share them without being the same company
  'logistics', 'transport', 'catering', 'hospitality', 'consulting', 'solutions', 'systems', 'technology', 'technologies',
  'engineering', 'construction', 'supplies', 'supply', 'industries', 'industrial', 'trading', 'facilities', 'facility',
  'security', 'media', 'marketing', 'events', 'medical', 'food', 'foods', 'energy', 'digital', 'holding', 'partners']);

export class S4Timeout extends Error {
  constructor(ms) { super(`No answer from S/4HANA within ${ms / 1000} s`); this.code = 'S4_TIMEOUT'; }
}

/** Rejects if the call takes longer than `ms`. The remote call itself keeps running; we just stop waiting. */
export function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new S4Timeout(ms)), ms); })])
    .finally(() => clearTimeout(timer));
}

const nameWords = (name = '') => name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));

/** The brand word of a company name: the first distinctive word, e.g. "Najd Facilities Services Co." -> "Najd". */
export const nameToken = (name) => nameWords(name)[0] || null;

/** Search words: the brand word plus the longest other word, e.g. ["Najd", "Facilities"]. */
export function nameTokens(name) {
  const [first, ...rest] = nameWords(name);
  const longest = rest.sort((a, b) => b.length - a.length)[0];
  return [first, longest].filter(Boolean);
}

/** BP name fields are 40 chars each in S/4; the rest spills into name 2. */
export function splitName(name = '') {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= 40) return [clean, ''];
  const cut = clean.lastIndexOf(' ', 40) > 20 ? clean.lastIndexOf(' ', 40) : 40;
  return [clean.slice(0, cut).trim(), clean.slice(cut).trim().slice(0, 40)];
}

const errorText = (e) => (e?.reason?.message || e?.message || String(e)).replace(/^Error during request to remote service: /, '');

// ---------------------------------------------------------------- duplicate check

const cache = new Map(); // applicationID -> { at, result }

/** contains(BusinessPartnerFullName, 'a') or contains(...'b'): CAP turns contains() into V2 substringof(). */
const byWords = (tokens) => tokens.flatMap((t, i) => [...(i ? ['or'] : []), { func: 'contains', args: [{ ref: ['BusinessPartnerFullName'] }, { val: t }] }]);

/** Query one S/4 system for partners with a similar name or the same VAT number. */
async function searchSystem(serviceName, { name, vatNumber }) {
  const started = Date.now();
  const tokens = nameTokens(name);
  const query = tokens.join(' ');
  try {
    const srv = await cds.connect.to(serviceName);
    const BP = `${srv.name}.A_BusinessPartner`, TAX = `${srv.name}.A_BusinessPartnerTaxNumber`;
    const cols = ['BusinessPartner', 'BusinessPartnerFullName', 'OrganizationBPName1', 'CreationDate'];
    const [byName, byTax] = await withTimeout(Promise.all([
      tokens.length ? srv.run(SELECT.from(BP).columns(cols).where(byWords(tokens)).limit(5)) : [],
      vatNumber ? srv.run(SELECT.from(TAX).columns('BusinessPartner').where({ BPTaxNumber: vatNumber }).limit(5)) : [],
    ]));
    const matches = byName.map((b) => ({
      businessPartner: b.BusinessPartner, name: b.BusinessPartnerFullName || b.OrganizationBPName1, matchedOn: 'name', createdOn: b.CreationDate || null,
    }));
    for (const t of byTax) {
      const hit = matches.find((m) => m.businessPartner === t.BusinessPartner);
      if (hit) hit.matchedOn = 'vatNumber';
      else matches.unshift({ businessPartner: t.BusinessPartner, name: null, matchedOn: 'vatNumber', createdOn: null });
    }
    return { system: serviceName, reachable: true, latencyMs: Date.now() - started, query, error: null, matches };
  } catch (e) {
    LOG.warn(`duplicate check against ${serviceName} failed:`, errorText(e));
    return { system: serviceName, reachable: false, latencyMs: Date.now() - started, query, error: errorText(e), matches: [] };
  }
}

/**
 * Looks for the supplier in the target S/4 (where we will create it) and in the public S/4HANA Cloud sandbox.
 * Never throws: an unreachable system is reported, not fatal. Cached per application for 10 minutes.
 */
export async function checkDuplicates(app, { fresh = false } = {}) {
  const hit = cache.get(app.ID);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  const input = { name: app.legalNameEn, vatNumber: app.vatNumber };
  const systems = await Promise.all(['API_BUSINESS_PARTNER', 'S4_SANDBOX'].map((s) => searchSystem(s, input)));
  const result = { checkedAt: new Date().toISOString(), systems };
  cache.set(app.ID, { at: Date.now(), result });
  return result;
}

export const clearDuplicateCache = (ID) => (ID ? cache.delete(ID) : cache.clear());

// ---------------------------------------------------------------- business partner creation

/**
 * Creates the supplier as an organization Business Partner. Idempotent: the application number is stored in
 * SearchTerm2, so a retry after a lost response finds the BP created the first time instead of creating a second one.
 * @returns {{ businessPartner: string, created: boolean, warning?: string }}
 */
export async function createBusinessPartner(app) {
  const srv = await cds.connect.to('API_BUSINESS_PARTNER');
  const BP = `${srv.name}.A_BusinessPartner`, TAX = `${srv.name}.A_BusinessPartnerTaxNumber`;

  let businessPartner = app.s4BusinessPartner;
  let created = false;
  if (!businessPartner) {
    const [existing] = await withTimeout(srv.run(SELECT.from(BP).columns('BusinessPartner').where({ SearchTerm2: app.applicationNo }).limit(1)));
    businessPartner = existing?.BusinessPartner;
  }
  if (!businessPartner) {
    const [name1, name2] = splitName(app.legalNameEn);
    const res = await withTimeout(srv.run(INSERT.into(BP).entries({
      BusinessPartnerCategory: '2', // organization
      OrganizationBPName1: name1,
      OrganizationBPName2: name2 || undefined,
      SearchTerm1: (nameToken(app.legalNameEn) || name1).toUpperCase().slice(0, 20),
      SearchTerm2: app.applicationNo,
      CorrespondenceLanguage: 'EN',
    })));
    businessPartner = (Array.isArray(res) ? res[0] : res)?.BusinessPartner;
    // Local (mocked) services return an insert result without the generated key; read it back by SearchTerm2
    if (!businessPartner) businessPartner = (await srv.run(SELECT.one.from(BP).columns('BusinessPartner').where({ SearchTerm2: app.applicationNo })))?.BusinessPartner;
    if (!businessPartner) throw new Error('S/4HANA did not return a Business Partner number');
    created = true;
  }

  // Tax number is a separate entity in API_BUSINESS_PARTNER. A failure here does not undo the BP;
  // it is reported as a warning so the reviewer knows to complete it in S/4.
  let warning;
  if (app.vatNumber) {
    try {
      const [has] = await withTimeout(srv.run(SELECT.from(TAX).columns('BPTaxNumber').where({ BusinessPartner: businessPartner, BPTaxType: VAT_TAX_TYPE })));
      if (!has) await withTimeout(srv.run(INSERT.into(TAX).entries({ BusinessPartner: businessPartner, BPTaxType: VAT_TAX_TYPE, BPTaxNumber: app.vatNumber })));
    } catch (e) {
      warning = `VAT number not stored in S/4: ${errorText(e)}`;
      LOG.warn(warning);
    }
  }
  return { businessPartner, created, warning };
}

export { errorText };
