// Registration workflow: allowed status transitions, required documents, risk scoring.
// Status names follow SAP Ariba SLP so procurement users recognise them (RESEARCH.md §B1).

export const S = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  IN_REVIEW: 'IN_REVIEW',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  APPROVED: 'APPROVED',
  REGISTERED: 'REGISTERED',
  REJECTED: 'REJECTED',
});

const TRANSITIONS = {
  [S.DRAFT]: [S.SUBMITTED],
  [S.SUBMITTED]: [S.IN_REVIEW, S.DRAFT /* withdraw */, S.REJECTED],
  [S.IN_REVIEW]: [S.APPROVED, S.REJECTED, S.CHANGES_REQUESTED],
  [S.CHANGES_REQUESTED]: [S.SUBMITTED],
  [S.APPROVED]: [S.REGISTERED],
  [S.REGISTERED]: [],
  [S.REJECTED]: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Statuses in which the supplier may edit (draftEdit allowed). */
export const EDITABLE = new Set([S.DRAFT, S.CHANGES_REQUESTED]);

/**
 * Which document types an application still needs, given its supplier type and uploaded documents.
 * docTypes: rows of DocumentTypes { code, requiredFor }.
 */
export function missingDocuments(app, docTypes) {
  const type = app.supplierType_code;
  if (!type) return [];
  const have = new Set((app.documents || []).filter((d) => d.fileName).map((d) => d.docType_code));
  return docTypes
    .filter((t) => (t.requiredFor || '').split(',').includes(type))
    .filter((t) => !have.has(t.code))
    .map((t) => t.code);
}

const DAY = 86400000;

/**
 * Transparent, rule-based risk score (0–100). Each rule is explainable to a reviewer,
 * which matters more here than a clever model.
 */
export function assessRisk(app, { duplicates = [], today = new Date() } = {}) {
  const factors = [];
  const add = (code, points) => factors.push({ code, points });

  if (duplicates.length) add('POSSIBLE_DUPLICATE', 20);
  if (app.establishedOn && today - new Date(app.establishedOn) < 365 * DAY) add('YOUNG_COMPANY', 15);
  if (!app.website) add('NO_WEBSITE', 5);
  if (app.supplierType_code === 'FOREIGN') add('FOREIGN_ENTITY', 10);
  if (app.vatExemptReason && !app.vatNumber) add('NOT_VAT_REGISTERED', 10);
  const expiring = (app.documents || []).filter((d) => d.expiryDate && new Date(d.expiryDate) - today < 30 * DAY);
  if (expiring.length) add('DOCUMENT_EXPIRING', 18);
  if (app.zakatCertExpiry && new Date(app.zakatCertExpiry) - today < 30 * DAY) add('ZAKAT_EXPIRING', 8);
  if (app.accountHolderMismatch) add('HOLDER_NAME_MISMATCH', 16);

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  const level = score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low';
  return { score, level, factors };
}
