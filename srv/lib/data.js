// Shared database helpers for the services.
import cds from '@sap/cds';

const db = () => cds.entities('tasjeel');

/** Application with the children the rules need (no binary document content). */
export async function readDeep(entity, ID) {
  return SELECT.one.from(entity, ID).columns((a) => {
    a`.*`;
    a.contacts((c) => c`.*`);
    a.categories((c) => c`.*`);
    a.documents((d) => { d.ID; d.docType_code; d.fileName; d.mediaType; d.size; d.issueDate; d.expiryDate; d.verificationStatus; });
  });
}

/** TSJ-2026-000401: gap-free per year, incremented inside the caller's transaction. */
export async function nextApplicationNo(year = new Date().getFullYear()) {
  const { Sequences } = db();
  const name = `TSJ-${year}`;
  const updated = await UPDATE(Sequences, name).set('value = value + 1');
  if (!updated) await INSERT.into(Sequences).entries({ name, value: 1 });
  const { value } = await SELECT.one.from(Sequences, name).columns('value');
  return `${name}-${String(value).padStart(6, '0')}`;
}

/** Other non-draft applications sharing an identifier that should be unique per supplier. */
export async function findDuplicates(app) {
  const { Applications } = db();
  const hits = [];
  for (const field of ['unifiedNo', 'vatNumber', 'iban']) {
    if (!app[field]) continue;
    const rows = await SELECT.from(Applications)
      .columns('ID', 'applicationNo', 'legalNameEn', 'status_code')
      .where({ [field]: app[field], ID: { '!=': app.ID }, status_code: { '!=': 'DRAFT' } });
    rows.forEach((r) => hits.push({ ID: r.ID, applicationNo: r.applicationNo, legalNameEn: r.legalNameEn, matchedOn: field, status: r.status_code }));
  }
  return hits;
}

/**
 * createdAt is set to the wall clock on purpose: CAP's managed default is the *transaction* time,
 * so two steps in one request (APPROVED → REGISTERED) would share a timestamp and sort randomly.
 */
export async function addHistory(application_ID, fromStatus, toStatus, note = null) {
  await INSERT.into(db().StatusHistory).entries({ application_ID, fromStatus, toStatus, note, createdAt: new Date().toISOString() });
}

/** Localized status name for messages, e.g. "Under review" / "قيد المراجعة". */
export async function statusName(code) {
  const [row] = await SELECT.localized.from(db().ApplicationStatus).columns('name').where({ code });
  return row?.name ?? code;
}
