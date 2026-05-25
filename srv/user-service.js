import cds from '@sap/cds';

const ROLES = ['Applicant', 'Reviewer', 'Admin'];

export default class UserService extends cds.ApplicationService {
  init() {
    this.on('me', (req) => {
      const { user } = req;
      // XSUAA / IAS: names come from the JWT. CAP exposes the token through authInfo (xssec 4).
      const token = user.authInfo?.token?.payload ?? user.tokenInfo?.getPayload?.() ?? {};
      const name = [token.given_name, token.family_name].filter(Boolean).join(' ') || user.attr?.name || user.id;
      return {
        id: user.id,
        name,
        email: token.email ?? (user.id.includes('@') ? user.id : null),
        roles: ROLES.filter((r) => user.is(r)),
        auth: cds.env.requires.auth?.kind,
      };
    });
    return super.init();
  }
}
