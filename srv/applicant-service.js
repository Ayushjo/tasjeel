import cds from '@sap/cds';
import { checkApplication, normalizeIdentifiers, STEP } from './lib/rules.js';
import * as v from './lib/validators.js';
import { S, EDITABLE, canTransition, assessRisk } from './lib/workflow.js';
import { nextApplicationNo, findDuplicates, readDeep, addHistory, statusName } from './lib/data.js';

const FILE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_MB = 5;

export default class ApplicantService extends cds.ApplicationService {
  init() {
    const { Applications, Contacts, Documents } = this.entities;
    const db = cds.entities('tasjeel');

    // ---- Draft lifecycle -------------------------------------------------------------

    this.before('NEW', Applications.drafts, (req) => {
      req.data.paymentCurrency_code ??= 'SAR';
      req.data.country_code ??= 'SA';
    });

    // Autosave: never block, only clean up what the user typed.
    this.before(['NEW', 'PATCH', 'UPDATE'], Applications.drafts, async (req) => {
      normalizeIdentifiers(req.data);
      if (req.data.iban) {
        const code = v.bankCodeFromIban(req.data.iban);
        req.data.bankCode_code = code;
        if (code) {
          const bank = await SELECT.one.from(db.BankCodes, code).columns('swift');
          if (bank?.swift) req.data.swift = bank.swift;
        }
      }
    });
    this.before(['NEW', 'PATCH', 'UPDATE'], Contacts.drafts, (req) => normalizeIdentifiers(req.data));

    // Uploads: type and size are checked as the file arrives.
    this.before(['PATCH', 'UPDATE'], Documents.drafts, (req) => {
      if (req.data.mediaType && !FILE_TYPES.has(req.data.mediaType)) req.reject(415, 'FILE_TYPE');
      const length = Number(req.http?.req?.headers?.['content-length'] || req.data.size || 0);
      if (length > MAX_MB * 1024 * 1024) req.reject(413, 'FILE_TOO_LARGE', [MAX_MB]);
    });

    // Locked while a reviewer owns it.
    this.before('EDIT', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const app = await SELECT.one.from(db.Applications, ID).columns('status_code');
      if (app && !EDITABLE.has(app.status_code)) req.reject(409, 'NOT_EDITABLE');
    });

    // Activation = full validation. Every finding targets the draft field it belongs to,
    // so UI5's message model highlights the exact input.
    this.before('SAVE', Applications, async (req) => {
      const { ID } = req.data;
      const active = await SELECT.one.from(db.Applications, ID).columns('status_code');
      if (active && !EDITABLE.has(active.status_code)) return req.reject(409, 'NOT_EDITABLE');

      const app = await readDeep(Applications.drafts, ID);
      const docTypes = await SELECT.localized.from(db.DocumentTypes);
      for (const f of checkApplication(app, { docTypes })) {
        const msg = { message: f.code, args: f.args, target: f.field };
        f.severity === 'error' ? req.error({ status: 400, ...msg }) : req.warn(msg);
      }
      if (app.declarationAccepted) req.data.declaredAt = new Date().toISOString();
    });

    // ---- Actions & functions ---------------------------------------------------------

    this.on('submit', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const app = await readDeep(db.Applications, ID);
      if (!app) return req.reject(404);
      if (!canTransition(app.status_code, S.SUBMITTED)) return req.reject(409, 'INVALID_TRANSITION', [await statusName(app.status_code)]);

      const docTypes = await SELECT.localized.from(db.DocumentTypes);
      const errors = checkApplication(app, { docTypes }).filter((f) => f.severity === 'error');
      if (errors.length) {
        errors.forEach((f) => req.error({ status: 400, message: f.code, args: f.args }));
        return req.reject(400, 'INCOMPLETE');
      }

      const duplicates = await findDuplicates(app);
      const risk = assessRisk(
        { ...app, accountHolderMismatch: !v.namesMatch(app.accountHolder, app.legalNameEn) && !v.namesMatch(app.accountHolder, app.legalNameAr) },
        { duplicates },
      );
      const version = (app.version || 0) + 1;
      const applicationNo = app.applicationNo || (await nextApplicationNo());

      await UPDATE(db.Applications, ID).with({
        status_code: S.SUBMITTED, applicationNo, version,
        submittedAt: new Date().toISOString(), riskScore: risk.score, riskLevel: risk.level,
      });
      await INSERT.into(db.Submissions).entries({ application_ID: ID, version, snapshot: JSON.stringify(app) });
      await UPDATE(db.ReviewFlags).set({ resolved: true }).where({ application_ID: ID, resolved: false });
      await addHistory(ID, app.status_code, S.SUBMITTED, version > 1 ? `Resubmitted as version ${version}` : null);

      return SELECT.one.from(Applications, ID);
    });

    this.on('withdraw', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const app = await SELECT.one.from(db.Applications, ID).columns('status_code');
      if (!app) return req.reject(404);
      if (app.status_code !== S.SUBMITTED) return req.reject(409, 'INVALID_TRANSITION', [await statusName(app.status_code)]);
      await UPDATE(db.Applications, ID).with({ status_code: S.DRAFT });
      await addHistory(ID, S.SUBMITTED, S.DRAFT, 'Withdrawn by supplier');
      return SELECT.one.from(Applications, ID);
    });

    this.on('requirements', [Applications, Applications.drafts], async (req) => {
      const { ID, IsActiveEntity } = req.params.at(-1);
      const app = await readDeep(IsActiveEntity === false ? Applications.drafts : db.Applications, ID);
      if (!app) return req.reject(404);
      const docTypes = await SELECT.localized.from(db.DocumentTypes);
      const findings = checkApplication(app, { docTypes });
      const steps = Object.values(STEP);
      const done = steps.filter((s) => !findings.some((f) => f.step === s && f.severity === 'error')).length;
      return {
        complete: !findings.some((f) => f.severity === 'error'),
        percent: Math.round((done / steps.length) * 100),
        items: findings.map((f) => ({
          field: f.field, code: f.code, step: f.step, severity: f.severity,
          message: cds.i18n.messages.at(f.code, req.locale || cds.env.i18n.default_language, f.args) ?? f.code,
        })),
      };
    });

    this.on('lookupIban', async (req) => {
      const iban = v.compact(req.data.iban);
      const valid = v.isSaudiIban(iban) || v.isIban(iban);
      const bankCode = v.bankCodeFromIban(iban);
      const [bank] = bankCode ? await SELECT.localized.from(this.entities.BankCodes).where({ code: bankCode }) : [];
      return { valid, formatted: v.formatIban(iban), bankCode, bankName: bank?.name ?? null, swift: bank?.swift ?? null };
    });

    return super.init();
  }
}
