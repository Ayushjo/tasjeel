// Mock behaviour for API_BUSINESS_PARTNER, used only where the service is *mocked*
// (mock-s4 on :4006, and in-process during tests). Real S/4HANA assigns numbers itself.
// Uses the global `cds` on purpose: this file is loaded by two apps (tasjeel and mock-s4),
// each with its own @sap/cds install, and must bind to whichever one loaded it.
const cds = globalThis.cds;

export default class MockBusinessPartner extends cds.ApplicationService {
  init() {
    const { A_BusinessPartner } = this.entities;

    this.before('CREATE', A_BusinessPartner, async (req) => {
      const d = req.data;
      if (!d.OrganizationBPName1 && !d.BusinessPartnerFullName) return req.reject(400, 'OrganizationBPName1 is required');
      if (!d.BusinessPartner) {
        const { max } = await SELECT.one`max(BusinessPartner) as max`.from(A_BusinessPartner);
        d.BusinessPartner = String(Math.max(Number(max) || 1000400, 1000400) + 1);
      }
      d.BusinessPartnerFullName ??= d.OrganizationBPName1;
      d.BusinessPartnerCategory ??= '2'; // organization
      d.CreationDate ??= new Date().toISOString().slice(0, 10);
      // Fault injection for resilience demos (toggled via POST /mock/outage on mock-s4)
      if (globalThis.MOCK_S4_OUTAGE) return req.reject(503, 'S/4HANA unavailable (simulated outage)');
    });

    return super.init();
  }
}
