using { tasjeel as db } from '../db/schema';
using { sap.common.Countries as CommonCountries, sap.common.Currencies as CommonCurrencies } from '@sap/cds/common';

/**
 * Supplier-facing API: one's own application, edited as a draft.
 * The wizard autosaves into the draft (PATCH); "Submit for review" = draftActivate + submit().
 */
@path: '/odata/v4/applicant'
@requires: 'Applicant'
service ApplicantService {

  @odata.draft.enabled
  @restrict: [
    { grant: ['READ', 'WRITE'], to: 'Applicant', where: 'createdBy = $user' },
    { grant: ['submit', 'withdraw', 'requirements'], to: 'Applicant', where: 'createdBy = $user' }
  ]
  entity Applications as projection on db.Applications excluding {
    riskScore, riskLevel, assignedTo, decidedBy
  } actions {
    /** Moves DRAFT / CHANGES_REQUESTED → SUBMITTED, assigns the application number, snapshots the data. */
    action submit() returns Applications;
    /** Pulls a submitted application back to DRAFT before a reviewer picks it up. */
    action withdraw() returns Applications;
    /** Live "What's still needed" list for the wizard's side panel (works on drafts). */
    function requirements() returns Requirements;
  };

  // Process records are readable only for one's own application (application.createdBy = $user).

  /** Comments the reviewer chose to share with the supplier. */
  @readonly
  @restrict: [{ grant: 'READ', to: 'Applicant', where: 'application.createdBy = $user' }]
  entity Comments as projection on db.Comments { ID, application, text, createdAt } where visibility = 'APPLICANT';

  /** Status timeline. Reviewer notes and identities stay internal (shared messages come through Comments). */
  @readonly
  @restrict: [{ grant: 'READ', to: 'Applicant', where: 'application.createdBy = $user' }]
  entity StatusHistory as projection on db.StatusHistory { ID, application, fromStatus, toStatus, createdAt };

  @readonly
  @restrict: [{ grant: 'READ', to: 'Applicant', where: 'application.createdBy = $user' }]
  entity ReviewFlags as projection on db.ReviewFlags { ID, application, field, note, createdAt } where resolved = false;

  @readonly entity SupplierTypes as projection on db.SupplierTypes;
  @readonly entity LegalForms as projection on db.LegalForms;
  @readonly entity Categories as projection on db.Categories;
  @readonly entity DocumentTypes as projection on db.DocumentTypes;
  @readonly entity BankCodes as projection on db.BankCodes;
  @readonly entity ApplicationStatus as projection on db.ApplicationStatus;
  @readonly entity Countries as projection on CommonCountries;
  @readonly entity Currencies as projection on CommonCurrencies;

  /** IBAN check + bank detection while typing (wizard banking step). */
  function lookupIban(iban : String) returns {
    valid    : Boolean;
    formatted: String;
    bankCode : String;
    bankName : String;
    swift    : String;
  };

  type Requirements {
    complete : Boolean;
    percent  : Integer;
    items    : many {
      field    : String;
      code     : String;
      step     : String;
      severity : String;
      message  : String;
    };
  }
}
