using ReviewService from './review-service';

// Fiori Elements: the approved-vendor list report + object page are generated from these annotations.
annotate ReviewService.Vendors with @(
  UI.HeaderInfo: {
    TypeName      : '{i18n>Vendor}',
    TypeNamePlural: '{i18n>Vendors}',
    Title         : { Value: legalNameEn },
    Description   : { Value: legalNameAr }
  },
  UI.SelectionFields: [ supplierType_code, city, riskLevel, s4SyncStatus ],
  UI.LineItem: [
    { Value: applicationNo, Label: '{i18n>ApplicationNo}' },
    { Value: legalNameEn, Label: '{i18n>LegalNameEn}' },
    { Value: legalNameAr, Label: '{i18n>LegalNameAr}' },
    { Value: unifiedNo, Label: '{i18n>UnifiedNo}' },
    { Value: city, Label: '{i18n>City}' },
    { Value: riskLevel, Label: '{i18n>Risk}' },
    { Value: s4BusinessPartner, Label: '{i18n>S4BP}' },
    { Value: s4SyncStatus, Label: '{i18n>S4Sync}' },
    { Value: decidedAt, Label: '{i18n>ApprovedOn}' }
  ],
  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Risk' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#BP' }
  ],
  UI.DataPoint #Risk: { Value: riskScore, Title: '{i18n>RiskScore}', TargetValue: 100, Visualization: #Progress },
  UI.DataPoint #BP: { Value: s4BusinessPartner, Title: '{i18n>S4BP}' },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: '{i18n>Company}', Target: '@UI.FieldGroup#Company' },
    { $Type: 'UI.ReferenceFacet', Label: '{i18n>TaxBanking}', Target: '@UI.FieldGroup#Tax' }
  ],
  UI.FieldGroup #Company: { Data: [
    { Value: applicationNo, Label: '{i18n>ApplicationNo}' },
    { Value: supplierType_code, Label: '{i18n>SupplierType}' },
    { Value: unifiedNo, Label: '{i18n>UnifiedNo}' },
    { Value: city, Label: '{i18n>City}' },
    { Value: district, Label: '{i18n>District}' },
    { Value: decidedAt, Label: '{i18n>ApprovedOn}' },
    { Value: decidedBy, Label: '{i18n>ApprovedBy}' }
  ]},
  UI.FieldGroup #Tax: { Data: [
    { Value: vatNumber, Label: '{i18n>VatNumber}' },
    { Value: iban, Label: '{i18n>Iban}' },
    { Value: s4BusinessPartner, Label: '{i18n>S4BP}' },
    { Value: s4SyncStatus, Label: '{i18n>S4Sync}' }
  ]}
) {
  supplierType @title: '{i18n>SupplierType}' @Common: { Text: supplierType.name, TextArrangement: #TextOnly,
    ValueListWithFixedValues, ValueList: { CollectionPath: 'SupplierTypes', Parameters: [
      { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplierType_code, ValueListProperty: 'code' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' } ] } };
  city         @title: '{i18n>City}';
  riskLevel    @title: '{i18n>Risk}';
  s4SyncStatus @title: '{i18n>S4Sync}';
};

annotate ReviewService.Contacts with @(UI.LineItem: [
  { Value: name, Label: '{i18n>Name}' },
  { Value: role, Label: '{i18n>Role}' },
  { Value: email, Label: '{i18n>Email}' },
  { Value: phone, Label: '{i18n>Phone}' },
  { Value: isPrimary, Label: '{i18n>Primary}' }
]);
