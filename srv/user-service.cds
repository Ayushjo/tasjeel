/**
 * Who am I? Feeds the UI's role-dependent navigation (UX only: every service enforces its own @requires).
 * GET /rest/user/me
 */
@protocol: 'rest'
@path: '/rest/user'
@requires: 'any'
service UserService {
  function me() returns {
    id    : String;
    name  : String;
    email : String;
    roles : many String;
    /** mocked (local demo users) | xsuaa | ias */
    auth  : String;
  };
}
