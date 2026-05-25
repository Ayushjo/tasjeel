using { tasjeel as db } from '../db/schema';

/** Master data maintenance + the approved-vendor list (rendered with Fiori Elements in Phase 5). */
@path: '/odata/v4/admin'
@requires: 'Admin'
service AdminService {
  entity SupplierTypes as projection on db.SupplierTypes;
  entity LegalForms as projection on db.LegalForms;
  entity Categories as projection on db.Categories;
  entity DocumentTypes as projection on db.DocumentTypes;
  entity BankCodes as projection on db.BankCodes;

  @readonly
  entity Vendors as projection on db.Applications {
    ID, applicationNo, legalNameEn, legalNameAr, unifiedNo, vatNumber,
    supplierType, country, city, s4BusinessPartner, s4SyncStatus, decidedAt, riskLevel,
    categories, contacts
  } where status.code in ('APPROVED', 'REGISTERED');
}
