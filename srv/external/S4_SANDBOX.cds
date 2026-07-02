/**
 * Consumption model for the S/4HANA Cloud sandbox (read-only duplicate check).
 * Only the fields Tasjeel reads, same entity names as API_BUSINESS_PARTNER (OData V2).
 * The full contract lives in API_BUSINESS_PARTNER.cds and is used for writes.
 */
@cds.external: true
service S4_SANDBOX {
  @cds.persistence.skip
  entity A_BusinessPartner {
    key BusinessPartner         : String(10);
        BusinessPartnerFullName : String(81);
        BusinessPartnerCategory : String(1);
        OrganizationBPName1     : String(40);
        SearchTerm1             : String(20);
        CreationDate            : Date;
  }

  @cds.persistence.skip
  entity A_BusinessPartnerTaxNumber {
    key BusinessPartner : String(10);
    key BPTaxType       : String(4);
        BPTaxNumber     : String(20);
  }
}
