using { tasjeel as db } from '../db/schema';

/** Procurement reviewer API: the queue, decisions and comments. Drafts are never visible here. */
@path: '/odata/v4/review'
@requires: 'Reviewer'
service ReviewService {

  @readonly @cds.redirection.target
  entity Applications as projection on db.Applications where status.code != 'DRAFT' actions {
    action startReview() returns Applications;
    /** Approves and creates the supplier as a Business Partner in S/4HANA (REGISTERED on success). */
    action approve(note : String) returns Applications;
    /** Re-runs the S/4HANA Business Partner creation after a failed sync. Idempotent. */
    action retrySync() returns Applications;
    action rejectApplication(reason : String not null) returns Applications;
    /** fields: wizard field names the supplier must fix, e.g. ['gosiNo','postalCode'] */
    action requestChanges(note : String not null, fields : many String) returns Applications;
    action addComment(text : String not null, visibility : String) returns Comments;
    /** Other applications sharing the unified number, VAT number or IBAN. */
    function duplicates() returns many DuplicateHit;
    /** Explainable risk: each factor with its points, recomputed on current data. */
    function riskBreakdown() returns RiskBreakdown;
    /** Looks for the supplier in the target S/4 and the S/4HANA Cloud sandbox (by name token and VAT number). */
    function s4Check(fresh : Boolean) returns S4Check;
  };

  /** Approved suppliers: rendered by the Fiori Elements list report (app/vendors). */
  @readonly
  entity Vendors as projection on db.Applications {
    ID, applicationNo, legalNameEn, legalNameAr, unifiedNo, vatNumber, iban,
    supplierType, legalForm, country, city, district, s4BusinessPartner, s4SyncStatus, s4SyncMessage, s4SyncedAt,
    riskLevel, riskScore, decidedAt, decidedBy, status
  } where status.code in ('APPROVED', 'REGISTERED');

  @readonly entity Documents as projection on db.Documents;
  @readonly entity Comments as projection on db.Comments;
  @readonly entity StatusHistory as projection on db.StatusHistory;
  @readonly entity ReviewFlags as projection on db.ReviewFlags;
  @readonly entity Submissions as projection on db.Submissions;
  @readonly entity ApplicationStatus as projection on db.ApplicationStatus;
  @readonly entity Categories as projection on db.Categories;
  @readonly entity DocumentTypes as projection on db.DocumentTypes;
  @readonly entity SupplierTypes as projection on db.SupplierTypes;
  @readonly entity Contacts as projection on db.Contacts;

  type RiskBreakdown {
    score   : Integer;
    level   : String;
    factors : many { code : String; points : Integer; label : String; };
  }

  type S4Check {
    checkedAt : Timestamp;
    systems   : many {
      system    : String; // API_BUSINESS_PARTNER (target) | S4_SANDBOX
      reachable : Boolean;
      latencyMs : Integer;
      query     : String;
      error     : String;
      matches   : many { businessPartner : String; name : String; matchedOn : String; createdOn : Date; };
    };
  }

  type DuplicateHit {
    ID            : UUID;
    applicationNo : String;
    legalNameEn   : String;
    matchedOn     : String; // unifiedNo | vatNumber | iban
    status        : String;
  }
}

/** Dashboard numbers as plain REST/JSON: GET /rest/stats/summary, /weekly, /byCategory */
@protocol: 'rest'
@path: '/rest/stats'
@requires: 'Reviewer'
service StatsService {
  function summary() returns {
    awaitingReview : Integer;
    approved       : Integer;
    rejected       : Integer;
    avgDecisionDays: Decimal(5, 1);
    slaBreaches    : Integer;
  };
  function weekly(weeks : Integer) returns many { week : String; submitted : Integer; };
  function byCategory() returns many { category : String; name : String; count : Integer; };
  function byStatus() returns many { status : String; name : String; count : Integer; };
}
