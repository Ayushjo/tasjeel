// Authorization matrix: every service enforces its own roles; the UI hiding things is only UX.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { test, as } from './setup.js';

const { GET, POST } = test;
const anon = {};
const NAJD = '8293e5d9-aeca-fbcd-9ab4-ca1669f8e977'; // owned by vendor1, IN_REVIEW
const status = async (req) => (await req).status;

describe('who am I', () => {
  it('reports roles per user, and the auth kind for the UI', async () => {
    const me = async (u) => (await GET('/rest/user/me', u ? as(u) : anon)).data;
    assert.deepEqual((await me()).roles, []);
    assert.equal((await me()).auth, 'mocked');
    assert.deepEqual((await me('vendor1')).roles, ['Applicant']);
    assert.deepEqual((await me('reviewer')).roles, ['Reviewer']);
    assert.deepEqual((await me('admin')).roles.sort(), ['Admin', 'Reviewer']);
  });
});

describe('authorization matrix', () => {
  const cases = [
    // [what, request(user), expected status per user]
    ['applicant service', (u) => GET('/odata/v4/applicant/Applications', u), { anon: 401, vendor1: 200, reviewer: 403, admin: 403 }],
    ['create a draft', (u) => POST('/odata/v4/applicant/Applications', {}, u), { anon: 401, reviewer: 403 }],
    ['review queue', (u) => GET('/odata/v4/review/Applications', u), { anon: 401, vendor1: 403, reviewer: 200, admin: 200 }],
    ['approve', (u) => POST(`/odata/v4/review/Applications(${NAJD})/ReviewService.approve`, { note: 'x' }, u), { anon: 401, vendor1: 403 }],
    ['dashboard stats', (u) => GET('/rest/stats/summary', u), { anon: 401, vendor1: 403, reviewer: 200 }],
    ['master data', (u) => GET('/odata/v4/admin/Categories', u), { anon: 401, vendor1: 403, reviewer: 403, admin: 200 }],
  ];
  for (const [what, call, expected] of cases) {
    for (const [user, code] of Object.entries(expected)) {
      it(`${what}: ${user} → ${code}`, async () => {
        assert.equal(await status(call(user === 'anon' ? anon : as(user))), code);
      });
    }
  }
});

describe('row-level ownership (createdBy = $user)', () => {
  it("a supplier cannot read another supplier's application", async () => {
    const own = await GET(`/odata/v4/applicant/Applications(ID=${NAJD},IsActiveEntity=true)`, as('vendor1'));
    assert.equal(own.status, 200);
    const other = await GET(`/odata/v4/applicant/Applications(ID=${NAJD},IsActiveEntity=true)`, as('vendor2'));
    assert.ok([403, 404].includes(other.status), `got ${other.status}`);
    const list = await GET('/odata/v4/applicant/Applications?$select=ID', as('vendor2'));
    assert.ok(!list.data.value.some((a) => a.ID === NAJD));
  });

  it("a supplier cannot withdraw another supplier's application", async () => {
    const res = await POST(`/odata/v4/applicant/Applications(ID=${NAJD},IsActiveEntity=true)/ApplicantService.withdraw`, {}, as('vendor2'));
    assert.ok([403, 404].includes(res.status), `got ${res.status}`);
  });

  it('reviewers never see drafts', async () => {
    const res = await GET("/odata/v4/review/Applications?$filter=status_code eq 'DRAFT'&$select=ID", as('reviewer'));
    assert.equal(res.data.value.length, 0);
  });
});

describe('process records are private to the application owner', () => {
  const A = '/odata/v4/applicant';
  before(async () => {
    // Give vendor1's application a shared comment and flagged fields, so there is something to leak.
    const R = `/odata/v4/review/Applications(${NAJD})/ReviewService`;
    await POST(`${R}.addComment`, { text: 'Shared with the supplier only.', visibility: 'APPLICANT' }, as('reviewer'));
    const res = await POST(`${R}.requestChanges`, { note: 'Please renew the GOSI certificate.', fields: ['gosiNo'] }, as('reviewer'));
    assert.equal(res.status, 200);
  });

  for (const entity of ['StatusHistory', 'Comments', 'ReviewFlags']) {
    it(`${entity}: the owner sees theirs, another supplier sees nothing`, async () => {
      const own = await GET(`${A}/${entity}?$filter=application_ID eq ${NAJD}`, as('vendor1'));
      assert.ok(own.data.value.length > 0, 'owner has records');
      const res = await GET(`${A}/${entity}?$filter=application_ID eq ${NAJD}`, as('vendor2'));
      assert.equal(res.status, 200);
      assert.equal(res.data.value.length, 0);
    });
  }

  it("the owner sees their own timeline, without reviewer notes or identities", async () => {
    const res = await GET(`${A}/StatusHistory?$filter=application_ID eq ${NAJD}`, as('vendor1'));
    assert.ok(res.data.value.length > 0);
    assert.ok(res.data.value.every((h) => !('note' in h) && !('createdBy' in h)));
  });
});
