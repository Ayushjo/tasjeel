namespace tasjeel;

using {
  cuid,
  managed,
  Country,
  Currency,
  sap.common.CodeList
} from '@sap/cds/common';
using from '@sap/cds-common-content';

/**
 * A supplier's registration request. One active row per supplier;
 * edits happen in a draft (see ApplicantService) and are locked while under review.
 */
entity Applications : cuid, managed {
  applicationNo       : String(20)  @readonly; // TSJ-2026-000123, assigned on first submit
  @readonly version             : Integer default 0; // bumped on every submit
  @readonly status              : Association to ApplicationStatus default 'DRAFT';
  supplierType        : Association to SupplierTypes; // LOCAL / GCC / FOREIGN, drives required fields + documents
  legalForm           : Association to LegalForms;

  // Company profile
  legalNameEn         : String(160);
  legalNameAr         : String(160);
  tradeName           : String(160);
  unifiedNo           : String(10); // Saudi unified national number "7XXXXXXXXX" (Commercial Register Law 2025)
  legacyCrNo          : String(10); // pre-2025 CR number, optional during the transition
  establishedOn       : Date;
  misaLicenseNo       : String(30); // foreign investors only
  isSme               : Boolean default false;
  website             : String(255);
  description         : String(1000);

  // National address (Saudi) or free-form address abroad
  country             : Country;
  city                : String(80);
  district            : String(80);
  street              : String(120);
  buildingNo          : String(4);
  postalCode          : String(10);
  additionalNo        : String(4);
  shortAddress        : String(8);

  // Tax & compliance
  vatNumber           : String(15);
  vatExemptReason     : String(255);
  zakatCertNo         : String(30);
  zakatCertExpiry     : Date;
  gosiNo              : String(20);
  chamberNo           : String(30);

  // Banking
  paymentCurrency     : Currency;
  iban                : String(34);
  bankCode            : Association to BankCodes;
  swift               : String(11);
  accountHolder       : String(160);

  // Declarations
  declarationAccepted : Boolean default false;
  declaredBy          : String(120);
  declaredAt          : Timestamp @readonly;

  // Review outcome (set by the review process only)
  riskScore           : Integer @readonly;
  riskLevel           : RiskLevel @readonly;
  submittedAt         : Timestamp @readonly;
  assignedTo          : String(255) @readonly;
  decidedAt           : Timestamp @readonly;
  decidedBy           : String(255) @readonly;
  s4BusinessPartner   : String(10) @readonly;
  s4SyncStatus        : SyncStatus @readonly;
  s4SyncMessage       : String(500) @readonly; // last error, or a warning after a partial sync
  s4SyncAttempts      : Integer @readonly;
  s4SyncedAt          : Timestamp @readonly;

  categories          : Composition of many ApplicationCategories on categories.parent = $self;
  contacts            : Composition of many Contacts on contacts.parent = $self;
  documents           : Composition of many Documents on documents.parent = $self;

  // Process records: associations (not compositions) so drafts never copy them
  comments            : Association to many Comments on comments.application = $self;
  history             : Association to many StatusHistory on history.application = $self;
  submissions         : Association to many Submissions on submissions.application = $self;
}

type RiskLevel  : String(6) enum { Low; Medium; High; };
type SyncStatus : String(10) enum { PENDING; SYNCED; FAILED; };

entity ApplicationCategories : cuid {
  parent   : Association to Applications;
  category : Association to Categories;
}

entity Contacts : cuid {
  parent    : Association to Applications;
  name      : String(120);
  role      : String(80);
  email     : String(254);
  phone     : String(20); // E.164, e.g. +966501234567
  isPrimary : Boolean default false;
  isSignatory : Boolean default false;
}

entity Documents : cuid, managed {
  parent             : Association to Applications;
  docType            : Association to DocumentTypes;
  fileName           : String(255);
  mediaType          : String(100) @Core.IsMediaType;
  size               : Integer;
  content            : LargeBinary @Core.MediaType: mediaType @Core.ContentDisposition.Filename: fileName;
  issueDate          : Date;
  expiryDate         : Date;
  @readonly verificationStatus : String(10) enum { PENDING; VERIFIED; REJECTED; } default 'PENDING';
  reviewerNote       : String(500) @readonly;
}

entity Comments : cuid, managed {
  application : Association to Applications;
  text        : String(2000);
  visibility  : String(10) enum { INTERNAL; APPLICANT; } default 'INTERNAL';
}

entity StatusHistory : cuid, managed {
  application : Association to Applications;
  fromStatus  : String(20);
  toStatus    : String(20);
  note        : String(2000);
}

/** Field-level change requests raised by a reviewer, e.g. field = 'gosiNo'. */
entity ReviewFlags : cuid, managed {
  application : Association to Applications;
  field       : String(60);
  note        : String(500);
  resolved    : Boolean default false;
}

/** Immutable JSON snapshot per submit, used for the "changes since v1" diff. */
entity Submissions : cuid, managed {
  application : Association to Applications;
  version     : Integer;
  snapshot    : LargeString;
}

/** Gap-free document numbers per prefix and year. */
entity Sequences {
  key name  : String(20);
  value     : Integer default 0;
}

// ---------- Code lists (texts are localized: see db/data/*_texts.csv for Arabic) ----------

entity ApplicationStatus : CodeList {
  key code    : String(20);
  criticality : Integer; // 0 neutral · 1 negative · 2 critical · 3 positive (Fiori convention)
  sortOrder   : Integer;
}

entity SupplierTypes : CodeList {
  key code : String(10);
}

entity LegalForms : CodeList {
  key code : String(10);
}

entity Categories : CodeList {
  key code : String(20);
}

entity DocumentTypes : CodeList {
  key code     : String(20);
  requiredFor  : String(40); // comma list of SupplierTypes codes, e.g. 'LOCAL,GCC'
  hasExpiry    : Boolean default false;
}

/** Saudi bank codes = IBAN characters 5–6. Kept as data, not code: the published mapping changes (e.g. bank mergers). */
entity BankCodes : CodeList {
  key code : String(2);
  swift    : String(11);
}
