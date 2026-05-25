import cds from '@sap/cds';
import { S, canTransition, assessRisk } from './lib/workflow.js';
import { namesMatch } from './lib/validators.js';
import { findDuplicates, addHistory, statusName, readDeep } from './lib/data.js';
import { checkDuplicates, createBusinessPartner, errorText } from './lib/s4.js';

const MIN_REASON = 10;

export class ReviewService extends cds.ApplicationService {
  init() {
    const { Applications } = this.entities;
    const db = cds.entities('tasjeel');

    /** Loads the application, checks the transition, writes status + history. */
    const transition = async (req, to, extra = {}, note = null) => {
      const { ID } = req.params.at(-1);
      const app = await SELECT.one.from(db.Applications, ID).columns('ID', 'status_code');
      if (!app) return req.reject(404);
      if (!canTransition(app.status_code, to)) return req.reject(409, 'INVALID_TRANSITION', [await statusName(app.status_code)]);
      await UPDATE(db.Applications, ID).with({ status_code: to, ...extra });
      await addHistory(ID, app.status_code, to, note);
      return ID;
    };
    const reread = (ID) => SELECT.one.from(Applications, ID);
    const now = () => new Date().toISOString();

    this.on('startReview', Applications, async (req) => {
      const ID = await transition(req, S.IN_REVIEW, { assignedTo: req.user.id });
      return ID && reread(ID);
    });

    /**
     * Pushes an approved application to S/4HANA. Never throws for S/4 problems: the approval stands,
     * the outcome is recorded on the application (SYNCED -> REGISTERED, or FAILED + message for retrySync).
     */
    const syncToS4 = async (ID) => {
      const app = await SELECT.one.from(db.Applications, ID)
        .columns('ID', 'applicationNo', 'legalNameEn', 'vatNumber', 's4BusinessPartner', 's4SyncAttempts', 'status_code');
      const attempts = (app.s4SyncAttempts || 0) + 1;
      try {
        const { businessPartner, created, warning } = await createBusinessPartner(app);
        await UPDATE(db.Applications, ID).with({
          s4BusinessPartner: businessPartner, s4SyncStatus: 'SYNCED', s4SyncMessage: warning || null,
          s4SyncAttempts: attempts, s4SyncedAt: now(), status_code: S.REGISTERED,
        });
        await addHistory(ID, S.APPROVED, S.REGISTERED, `Business Partner ${businessPartner}${created ? '' : ' (found existing)'}`);
      } catch (e) {
        cds.log('s4').error(`BP creation for ${app.applicationNo} failed (attempt ${attempts}):`, errorText(e));
        await UPDATE(db.Applications, ID).with({ s4SyncStatus: 'FAILED', s4SyncMessage: errorText(e).slice(0, 500), s4SyncAttempts: attempts });
      }
    };

    this.on('approve', Applications, async (req) => {
      const ID = await transition(req, S.APPROVED, { decidedAt: now(), decidedBy: req.user.id, s4SyncStatus: 'PENDING', s4SyncMessage: null }, req.data.note || null);
      if (!ID) return;
      await syncToS4(ID);
      return reread(ID);
    });

    this.on('retrySync', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const app = await SELECT.one.from(db.Applications, ID).columns('status_code', 's4SyncStatus');
      if (!app) return req.reject(404);
      if (app.status_code !== S.APPROVED || app.s4SyncStatus === 'SYNCED') return req.reject(409, 'SYNC_NOT_RETRYABLE');
      await syncToS4(ID);
      return reread(ID);
    });

    this.on('s4Check', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const app = await SELECT.one.from(db.Applications, ID).columns('ID', 'legalNameEn', 'vatNumber');
      return app ? checkDuplicates(app, { fresh: !!req.data.fresh }) : req.reject(404);
    });

    this.on('rejectApplication', Applications, async (req) => {
      const reason = (req.data.reason || '').trim();
      if (reason.length < MIN_REASON) return req.reject({ status: 400, message: 'REASON_TOO_SHORT', args: [MIN_REASON], target: 'in/reason' });
      const ID = await transition(req, S.REJECTED, { decidedAt: now(), decidedBy: req.user.id }, reason);
      if (ID) await INSERT.into(db.Comments).entries({ application_ID: ID, text: reason, visibility: 'APPLICANT' });
      return ID && reread(ID);
    });

    this.on('requestChanges', Applications, async (req) => {
      const note = (req.data.note || '').trim();
      if (note.length < MIN_REASON) return req.reject({ status: 400, message: 'REASON_TOO_SHORT', args: [MIN_REASON], target: 'in/note' });
      const ID = await transition(req, S.CHANGES_REQUESTED, {}, note);
      if (!ID) return;
      await INSERT.into(db.Comments).entries({ application_ID: ID, text: note, visibility: 'APPLICANT' });
      const fields = req.data.fields || [];
      if (fields.length) await INSERT.into(db.ReviewFlags).entries(fields.map((field) => ({ application_ID: ID, field })));
      return reread(ID);
    });

    this.on('addComment', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const visibility = req.data.visibility === 'APPLICANT' ? 'APPLICANT' : 'INTERNAL';
      const entry = { ID: cds.utils.uuid(), application_ID: ID, text: req.data.text, visibility };
      await INSERT.into(db.Comments).entries(entry);
      return SELECT.one.from(this.entities.Comments, entry.ID);
    });

    this.on('duplicates', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const app = await SELECT.one.from(db.Applications, ID).columns('ID', 'unifiedNo', 'vatNumber', 'iban');
      return app ? findDuplicates(app) : req.reject(404);
    });

    this.on('riskBreakdown', Applications, async (req) => {
      const { ID } = req.params.at(-1);
      const app = await readDeep(db.Applications, ID);
      if (!app) return req.reject(404);
      const duplicates = await findDuplicates(app);
      const mismatch = !namesMatch(app.accountHolder, app.legalNameEn) && !namesMatch(app.accountHolder, app.legalNameAr);
      const risk = assessRisk({ ...app, accountHolderMismatch: mismatch }, { duplicates });
      return { ...risk, factors: risk.factors.map((f) => ({ ...f, label: cds.i18n.messages.at('RISK_' + f.code, req.locale) ?? f.code })) };
    });

    return super.init();
  }
}

export class StatsService extends cds.ApplicationService {
  init() {
    const db = cds.entities('tasjeel');
    const DAY = 86400000;

    this.on('summary', async () => {
      const rows = await SELECT.from(db.Applications).columns('status_code', 'submittedAt', 'decidedAt');
      const count = (...codes) => rows.filter((r) => codes.includes(r.status_code)).length;
      const decided = rows.filter((r) => r.decidedAt && r.submittedAt);
      const avg = decided.length ? decided.reduce((s, r) => s + (new Date(r.decidedAt) - new Date(r.submittedAt)) / DAY, 0) / decided.length : 0;
      const slaBreaches = rows.filter((r) => [S.SUBMITTED, S.IN_REVIEW].includes(r.status_code) && r.submittedAt && Date.now() - new Date(r.submittedAt) > 3 * DAY).length;
      return {
        awaitingReview: count(S.SUBMITTED, S.IN_REVIEW),
        approved: count(S.APPROVED, S.REGISTERED),
        rejected: count(S.REJECTED),
        avgDecisionDays: Math.round(avg * 10) / 10,
        slaBreaches,
      };
    });

    this.on('weekly', async (req) => {
      const weeks = Math.min(Math.max(req.data.weeks || 8, 1), 52);
      const since = new Date(Date.now() - weeks * 7 * DAY);
      const rows = await SELECT.from(db.Applications).columns('submittedAt').where({ submittedAt: { '>=': since.toISOString() } });
      return Array.from({ length: weeks }, (_, i) => {
        const start = new Date(since.getTime() + i * 7 * DAY), end = new Date(start.getTime() + 7 * DAY);
        return { week: start.toISOString().slice(0, 10), submitted: rows.filter((r) => new Date(r.submittedAt) >= start && new Date(r.submittedAt) < end).length };
      });
    });

    this.on('byCategory', async () => {
      const rows = await SELECT.localized.from(db.ApplicationCategories).columns('category_code as category', 'category.name as name', 'count(*) as count')
        .groupBy('category_code', 'category.name').orderBy('count desc');
      return rows;
    });

    this.on('byStatus', async () =>
      SELECT.localized.from(db.Applications).columns('status_code as status', 'status.name as name', 'count(*) as count').groupBy('status_code', 'status.name'),
    );

    return super.init();
  }
}
