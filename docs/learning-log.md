# Learning log

One entry per phase: what I built, the SAP concepts behind it, and what surprised me. This doubles as interview prep.

## Phase 0: Toolchain and skeleton

**Built:** a CAP Node.js project (`cds init tasjeel --add nodejs,sqlite`) that serves at `localhost:4004`.

**Concepts**
- **CAP (Cloud Application Programming model):** SAP's framework for business apps. You describe data and services in **CDS** files, and CAP generates OData/REST endpoints, a database schema and the generic CRUD logic. Custom logic goes into JS event handlers.
- **`cds-dk` vs `@sap/cds`:** `cds-dk` is the developer CLI (`cds init`, `cds add`, `cds watch`, `cds import`). `@sap/cds` is the runtime the app depends on.
- **Facets (`cds add …`):** features get added as the project grows: `sqlite` now, then later `xsuaa` (auth), `hana` (database), `mta` (deployment descriptor), `approuter`, `html5-repo`, `workzone-standard`, `connectivity` and `destination`.
- **SQLite for dev, HANA for prod:** the same CDS model deploys to either. Local dev runs on an in-memory SQLite database.
- **MTA + `mbt` + `cf deploy`:** an MTA bundles the app modules and the BTP service instances they need into one `.mtar`, and the Cloud Foundry `multiapps` plugin deploys it.

**Toolchain:** Node 24 LTS (pinned in `.nvmrc`, via `fnm`; CAP 10 needs Node ≥ 22) · `@sap/cds-dk` 10.1 · UI5 CLI 4 · `mbt` 1.2 · Cloud Foundry CLI 8.19 + `multiapps` plugin.

**Surprises**
- npm 11 blocks package install scripts by default, so `mbt` needed `--allow-scripts=mbt`.
- Homebrew now refuses untrusted taps, so I installed the CF CLI from its official GitHub release instead.

## Phase 2: CAP domain model, services, validation, tests

**Built:** the full backend, running locally on SQLite with 26 seeded suppliers:
- 3 OData V4 services (applicant / review / admin) and 1 REST service (stats).
- A draft-based registration lifecycle, field-level validation in EN/AR, and a workflow with history and versioning.
- 26 passing tests (`npm test`).

**Concepts**
- **CDS domain model:** `cuid` + `managed` aspects give UUID keys and createdAt/createdBy/modifiedAt/modifiedBy for free. **Compositions** (contacts, documents, categories) are owned children that live and die with the parent and are copied into drafts. **Associations** (comments, history) are references, which is why process records aren't compositions: drafts must never copy them.
- **Code lists:** `sap.common.CodeList` plus `_texts.csv` files give localized names. A request with `Accept-Language: ar` returns Arabic names automatically. Queries I write myself in handlers need `SELECT.localized` to get the same behaviour.
- **Draft (`@odata.draft.enabled`):** every edit goes into a shadow "draft" copy (`IsActiveEntity=false`). The UI autosaves with PATCH, `draftActivate` copies it to the active row, and `draftEdit` starts a new draft from the active one. Handlers can hook into `NEW`, `PATCH`, `SAVE` (activation) and `EDIT`. Validation lives in `SAVE`, so autosave never blocks typing.
- **Field-level errors:** `req.error({ message, args, target })`. The `target` is the field name, so UI5's message model can put the red border on the exact input. The message is an i18n key from `_i18n/messages*.properties`, translated per request. CAP's positional order is `(code, message, target, args)`, so I use the object form to avoid mistakes.
- **Authorization:** `@requires` (role check per service) plus `@restrict … where: 'createdBy = $user'` (instance-based: suppliers only ever see their own rows). Bound actions and functions must be granted explicitly (`requirements()` returned 403 until it was).
- **Bound vs unbound:** `submit()` is bound to an application (`/Applications(ID=…)/ApplicantService.submit`). `lookupIban()` is unbound (service level). On a draft, the bound call is addressed to `Applications.drafts`, so the handler registers for both.
- **REST protocol:** `@protocol: 'rest'` serves the same CDS functions as plain JSON (`/rest/stats/summary`). That's simpler for dashboards than OData.
- **Testing:** `cds.test()` boots the real server in-process with an in-memory DB, and `node:test` drives it over HTTP as different mock users.

**Design decisions worth explaining in an interview**
- One rule engine (`srv/lib/rules.js`) feeds the wizard's "What's still needed" panel, draft activation and submit, so the UI and the server can never disagree.
- Statuses follow SAP Ariba's names (Pending approval, Changes requested…) because procurement users already know them.
- Bank codes are data, not code: the published IBAN→bank mapping changes when banks merge.
- The risk score is rule-based and explainable (each factor has points), not a black box. Reviewers need to justify decisions.
- Application numbers come from a sequence table updated inside the submit transaction, so they're gap-free per year.

**Surprises**
- `IsActiveEntity` is virtual, so you can't filter on it in your own queries.
- An action named `reject` collides with CAP's own `srv.reject()`, so it's called `rejectApplication`.

## Phase 3: UI5 foundation (shell, theme, i18n/RTL, custom controls)

**Built:** `app/portal`, a freestyle SAPUI5 1.148 LTS app served by CAP at `/portal/webapp/index.html`:
- `ToolPage` shell with role-based areas (public / supplier / procurement) and route guards.
- Side navigation that collapses to an icon rail below 1200px, plus a custom bottom tab bar on phones.
- A Tasjeel theme layer in LESS over `sap_horizon` / `sap_horizon_dark`.
- Arabic RTL, Phosphor as a registered UI5 icon font, and 4 custom controls.
- Real data: OData V4 inbox with server-side search, REST dashboard KPIs.

**Concepts**
- **Component + manifest.json:** the manifest declares data sources, models, routing and CSS. `Component.js` is the app's entry point (`ComponentSupport` boots it from `index.html`).
- **Routing:** `pattern → target → view`. Views are created lazily on first navigation, so a `patternMatched` handler attached in `onInit` misses the first visit. Load once in `onInit` as well.
- **Theming parameters:** Horizon exposes its design as CSS custom properties (`--sapBrandColor`, `--sapButton_BorderCornerRadius`, …). Overriding them on `:root:root` (more specific than the theme's `:root`) restyles every standard control. That beats per-control CSS hacks, and the names come from `SAP/theming-base-content`.
- **Icon fonts:** `IconPool.registerFont` + a name→codepoint JSON makes `sap-icon://phosphor/house` work everywhere UI5 accepts icons.
- **Custom controls:** `Control.extend` + an `apiVersion: 2` renderer (`openStart` / `class` / `openEnd` / `close`, `rm.icon`). Logo, StatusTag (colour + text, never colour alone), PatternPanel and TabBar(+Item).
- **RTL:** UI5 sets `dir="rtl"` for Arabic at boot and mirrors its controls. My CSS uses logical properties (`margin-inline-start`, `inset-inline-end`) so it mirrors for free. IDs and IBANs get `direction: ltr; unicode-bidi: isolate`. Directional custom icons need an explicit flip.
- **OData V4 model:** `changeHttpHeaders` throws while requests are open, so models are reset before switching the demo user, and `earlyRequests` is off until someone has signed in.

**Bugs found by testing in the browser (Brave)**
- Sign-in did nothing: `earlyRequests` started a `$metadata` call before sign-in, and `changeHttpHeaders` then threw.
- The language switch didn't reload: `location.replace()` to the same URL with a `#hash` is just an in-page jump. Use `location.reload()`.
- Dashboard KPIs were empty on the first visit (lazy view creation, see above).
- Horizon leaks: the dark bottom border on inputs (`--sapField_BackgroundStyle`), italic placeholders, blue avatars (`--sapAvatar_6_*`), blue info strips (`--sapMessage_InformationBorderColor`).
- Test-tool lesson: UI5 buttons fire `press` on a real mousedown→mouseup "tap". A bare synthetic `click()` doesn't trigger them, which is useful to know for test automation (OPA/wdi5 handle it properly).

## Phase 4: Registration wizard (draft, autosave, uploads, submit)

**Built:** a 9-step bilingual wizard on top of CAP's draft:
- Pre-registration → company → address & contacts → tax → banking → products → documents → declarations → review.
- Numbered step rail, live "What's still needed" panel with a progress ring, inline field errors, live IBAN → bank detection.
- Document upload into the draft, check-answers review, then submit → `TSJ-2026-000419`.
- Locked state while under review, and a success state.
- Verified end to end in Brave, in EN/AR, light/dark, at 1440/1024/390.

**Concepts**
- **Opening the draft (OData V4):**
  - Find the user's row with `$filter: IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null` (drafts plus actives without a draft).
  - If there's none, `create({})` makes a new draft.
  - If there's an editable active one, invoke the bound `draftEdit(...)` with `PreserveChanges`.
- **Autosave:** the view's element binding uses `$$updateGroupId: '$auto'`, so every field change is sent as a PATCH immediately. The binding's `patchSent` / `patchCompleted` events drive the "Saving… / Saved" indicator.
- **Side effects:** the server rewrites some fields (normalized IDs; bank code and SWIFT from the IBAN). `context.requestSideEffects([...])` re-reads just those properties after a save.
- **Bound function in a path:** `.../Applications(ID=…,IsActiveEntity=false)/ApplicantService.requirements()` is read with `bindContext(...).requestObject()`. One server rule engine feeds the panel, step badges, field errors and activation.
- **Compositions from the UI:** relative list bindings (`contacts`, `categories`, `documents`) on the draft context. Use `create({...}, true)` to add a row and `context.delete('$auto')` to remove one.
- **Media upload:** create the `Documents` row in the draft first, then `PUT` the binary to `…/documents(ID=…,IsActiveEntity=false)/content` (CAP `LargeBinary` + `@Core.MediaType`).
- **Submit:** invoke `draftActivate(...)` with `$$inheritExpandSelect`, then invoke the bound `submit(...)` on the returned active context.

**Bugs found by testing in Brave**
- Plain objects passed as sorters → `getGroupPaths is not a function`. Use `$orderby` or real `Sorter`s.
- IBAN never saved: calling `setValue()` while typing resets Input's last-value tracking, so `change` never fired. Fix: look up the bank on `liveChange`, save and reformat on `change`.
- Expression bindings on V4 properties inside fragments didn't update the type-dependent visibility. Fix: mirror `supplierType` / `currency` into the view model.
- RTL: UI5 marks every custom-font icon as mirrorable and flips its `::before`, which turned checkmarks into "V"s. Fix: cancel that for Phosphor glyphs and mirror only directional ones.
- Horizon's invalid-field style (`--sapField_Invalid*`: pink inner shadow, no border) was too faint. Fix: map it to a solid red border, and print the message under the field instead of a popup.
- "Missing" findings now appear only after the user tries to leave a step. Format errors appear immediately.

## Phase 5: Reviewer side (inbox, decisions, dashboard, Fiori Elements)

**Built:**
- **Inbox:** a `FlexibleColumnLayout` (queue ↔ detail, deep-linkable `#/inbox/{id}`, collapses to one column on phones). Server-side filter segments and search, J/K/Esc keyboard triage.
- **Detail:** header with status and risk, status-dependent actions:
  - Start review.
  - Approve with an optional note.
  - Request changes with flagged fields.
  - Reject, which needs a reason and runs a 5-second countdown with Undo before anything is sent.
- **Detail tabs:**
  - Overview: company facts, duplicate check, explainable risk breakdown, contacts.
  - Documents: preview via UI5's `PDFViewer`, fetched with auth into a blob URL.
  - Activity: a timeline merging status history and comments, plus internal or shared comments.
- **Dashboard:** KPI strip, weekly volume, status breakdown, SLA table, top categories. The charts come from a small custom SVG `Chart` control.
- **Approved vendors:** a **Fiori Elements** list report + object page generated purely from `srv/annotations.cds` (`UI.LineItem`, `SelectionFields`, `HeaderInfo`, `Facets`, `FieldGroup`, `DataPoint`).
- Verified in Brave: request changes → the supplier's wizard reopens with the reviewer's message; reject countdown; queue refresh.

**Concepts**
- **FlexibleColumnLayout:** the `layout` property (`OneColumn` / `TwoColumnsMidExpanded` / `MidColumnFullScreen`) is driven by the route. The detail is a nested XML view that the inbox controller tells which id to show.
- **Bound actions from the UI:** `bindContext("ReviewService.approve(...)", ctx)` + `setParameter` + `invoke()`, then `requestSideEffects([...])` to refresh only what changed.
- **Fiori Elements vs freestyle:**
  - FE generates CRUD/list/detail apps from annotations, with no view code at all.
  - Freestyle is for custom UX like the wizard and inbox.
  - Knowing when to use which is part of the job.
- **`@cds.redirection.target`:** with two projections of the same entity in a service, CAP needs to know which one associations should point to.
- **Explainable risk:** `riskBreakdown()` recomputes the factors with the same rules used at submit. The seed data was regenerated from those rules so the queue, header and breakdown always agree.

**Bugs found by testing**
- **The router silently stopped navigating.** In OData V4 expression bindings, `${prop}` converts to the *target control property's* type first, so `${status_code} === 'IN_REVIEW'` on a boolean `visible` threw `FormatException`s that broke the target display. Fix: use `%{prop}` (raw value). This also explains the Phase 4 visibility issue.
- Dates disappeared in Arabic: V4 passes formatters a locale-formatted string. Fix: `targetType: 'any'` for raw values.
- REST `fetch()` calls need an explicit `Accept-Language`, otherwise the server answers in English.
- `$top` isn't allowed as a V4 binding parameter (it's controlled by `requestContexts(start, length)`).
- **FE app rendered into a 0-px container:** the `data-sap-ui-component` placeholder div needs `height: 100%`.
- `CustomData` written to the DOM must be a string.

## Phase 6: S/4HANA integration (Business Partner)

**Built:**
- **Two remote services** in `package.json > cds.requires`, each with `[development]` / `[production]` credentials:
  - `S4_SANDBOX`: the public S/4HANA Cloud sandbox on api.sap.com. It is read-only and used for the duplicate check. The API key lives only in the gitignored `.cdsrc-private.json`.
  - `API_BUSINESS_PARTNER`: the target S/4 where suppliers are created. In dev that is `mock-s4/` on :4006. In prod it will be the `S4_ONPREM` destination through the Cloud Connector (Phase 9).
- **`mock-s4/`:** a tiny CAP app that serves the *real* `API_BUSINESS_PARTNER` contract (imported from the sandbox `$metadata`) over **OData V2**, using `@cap-js-community/odata-v2-adapter`. It assigns BP numbers like S/4 does, and `POST /mock/outage {"on":true}` simulates downtime.
- **Duplicate check, `s4Check()`:** queries both systems in parallel by brand word plus longest word (`contains` → V2 `substringof`) and by VAT number (`A_BusinessPartnerTaxNumber`).
  - It reports reachability and latency per system.
  - A down system is shown, never fatal.
  - Results are cached for 10 minutes per application to protect the sandbox rate limit.
- **Approve → Business Partner:**
  - Creates an organization BP: name split into the 40-char `OrganizationBPName1/2`, `SearchTerm1` = brand word, `SearchTerm2` = application no.
  - Then adds the VAT number (`BPTaxType SA1`).
  - On success: `s4SyncStatus SYNCED`, status **REGISTERED**, and a history entry with the BP number.
- **Resilience:**
  - 5-second timeout on every S/4 call.
  - Failures keep the approval (`APPROVED` + `FAILED` + message + attempt count).
  - `retrySync()` re-runs the sync.
  - **Idempotent:** before creating, it looks up `SearchTerm2 = applicationNo`. A retry after a lost response therefore adopts the BP created the first time instead of making a duplicate (covered by a test).
- **UI:** an SAP S/4HANA card in the reviewer detail with sync state, BP number, the raw error, a retry button and per-system matches. The toast tells the reviewer what happened in S/4.
- **Tests:** `test/setup.js` makes them hermetic:
  - the target S/4 runs **in-process as a CAP mock** (`--with-mocks` + no credentials);
  - the sandbox points at a closed port to cover the "unreachable" path.
  - The suite has 36 tests.

**Concepts**
- **Consuming remote services in CAP:** `cds import` turns EDMX into CDS. `cds.connect.to('X')` returns a RemoteService you query with plain CQL; CAP translates it to OData V2 (`$filter`, `substringof`, `/Date()/`).
- **Mocking:** an external service with no credentials is served by CAP itself (the in-memory DB plus an optional `<model>.js` impl). The same contract runs in tests, in dev (`mock-s4`) and against real S/4 in production.
- **Two consumption models for one API:** a datasource maps to exactly one service definition, so the sandbox gets a slim `@cds.external` model (`S4_SANDBOX.cds`) with only the fields we read.
- **Why not one transaction:** the S/4 call can't be rolled back with our DB. So the approval is committed state, the S/4 outcome is recorded next to it, and a retry is always safe.
- **Production upgrade path:** move the sync into CAP's **persistent outbox** (`cds.queued`) so retries happen automatically in the background. The manual retry stays as the operator override.

**Bugs found by testing**
- The EDMX download from the sandbox was gzipped (`curl --compressed`).
- Two `cds.requires` entries can't point at the same service definition, which is why the slim sandbox model exists.
- Port 4005 was already taken by another local project, so the mock moved to 4006.
- `@sap/cds` was "loaded from different locations": the shared mock impl imported `cds`, which resolved to a different install for the root app and `mock-s4`. Fix: the impl uses `globalThis.cds`.
- In-process (mocked) `INSERT` returns an insert result, not the created row, so the generated BP number was missing. Fix: read it back by `SearchTerm2`.
- Arabic timeline lines started with the Latin user id, so the paragraph rendered LTR. Fix: Unicode-isolate the id and set the text direction from the UI language.

## Phase 7: Security (XSUAA, roles, approuter)

**Built:**
- **`xs-security.json`:**
  - scopes `Applicant` / `Reviewer` / `Admin`, each with a matching role template;
  - role collections `Tasjeel_Applicant`, `Tasjeel_Reviewer` and `Tasjeel_Admin` (Admin + Reviewer);
  - 30-minute token validity;
  - redirect URIs for `*.cfapps.ap21`, Work Zone and the local approuter.
- **Auth per profile** (`package.json > cds.requires.auth`): `[development]` mocked users (unchanged), `[hybrid]` and `[production]` XSUAA (`@sap/xssec` 4).
- **`app/router` (`@sap/approuter`):**
  - XSUAA login per route; `/odata` and `/rest` go to the `srv-api` destination with CSRF protection.
  - 30-minute session, `/logout` → a static `signed-out.html` page served without auth.
  - For now the UI is also served through CAP. Phase 8 switches it to the HTML5 repo.
- **`GET /rest/user/me`:**
  - Returns id, name and email (from the JWT) plus roles and the auth kind.
  - The portal calls it before routing starts:
    - `mocked` → demo user picker (local dev unchanged);
    - `xsuaa` → the real identity, area by role, real logout;
    - no role → a "no access yet" screen that names the role collections to ask for.
- **CSRF:** OData V4 handles tokens itself. The one raw `fetch` PUT (document upload) now fetches a token first (`getWriteHeaders()`).
- **Tests:** `test/security.test.js` has 23 tests:
  - an authorization matrix (anonymous 401, wrong role 403, right role 200) across applicant, review, stats and admin;
  - row-level ownership (vendor2 can't read or withdraw vendor1's application);
  - reviewers never see drafts.
  - The full suite has 59 tests.
- **Hybrid run:** `cf create-service xsuaa application tasjeel-auth -c xs-security.json` → `cds bind auth --to tasjeel-auth` → `npm run hybrid` (CAP :4008, real JWT validation) + `npm run router:hybrid` (approuter :5001).
- Verified in Brave with a real SAP ID login (SSO):
  - `/rest/user/me` returned the real name and email with `roles: []`;
  - every service returned 403;
  - a POST without a CSRF token was rejected by the approuter;
  - the UI showed the no-access screen in EN and AR.

- After assigning `Tasjeel_Admin` in the cockpit and signing in again:
  - the token carried `Reviewer` + `Admin`;
  - the admin landed on the dashboard;
  - the review, stats and admin services returned 200 and applicant returned 403;
  - "Start review" went through the approuter with CSRF;
  - history and the "Mine" filter show the real SAP ID;
  - the Fiori Elements vendors app works behind the approuter.

**Concepts**
- **Scope → role template → role collection → user:**
  - Scopes are what the app checks (`@requires: 'Reviewer'` matches the scope `$XSAPPNAME.Reviewer`; CAP strips the prefix).
  - Role templates group scopes and can carry attributes.
  - Role collections are what an admin assigns to users in the cockpit.
- **The OAuth2 flow:** the browser hits the approuter → redirect to XSUAA (which delegates to SAP ID) → authorization code → the approuter exchanges it for a JWT, keeps it in the session, and forwards it as `Authorization: Bearer` (`forwardAuthToken`). CAP only validates the JWT (signature, audience = xsappname, expiry) and reads its scopes.
- **Why `$user` matters:** `@restrict where: 'createdBy = $user'` is the same rule for mock users and real SAP IDs. With XSUAA, `$user` is the logon name (email).
- **UI checks are UX only.** The UI hides what you can't use; the server refuses it regardless (proven by the 403s with a real token).
- **`cds bind`:** it stores only a *reference* to the service key in `.cdsrc-private.json` (gitignored). The secrets are fetched from CF at runtime, so nothing sensitive lives in the repo.

**Bugs found by testing**
- The approuter must run from its own folder (it looks for `xs-app.json` in the cwd).
- Port 5000 is taken by macOS AirPlay Receiver (ControlCenter), so the local approuter uses 5001 and the redirect URI was updated to match.
- The FE vendors app's local Basic-auth shim was keyed on `localhost`, so it would also have fired behind the local approuter. It is now keyed on the CAP dev port (:4004).

## Supplier home (finishing Phase 4)

The supplier overview had stayed a placeholder since Phase 3. It is now a real screen, built from the Figma design:
- greeting, plus a 5-stage tracker (Draft → Submitted → Review → Approved → Registered in SAP) with dates from the status history;
- one banner per status that says what is happening and what to do next: continue or "review & submit" (draft), withdraw to edit (submitted), fix flagged fields with a deep link to the wizard step (changes requested), and the SAP supplier number once registered;
- company summary with a status-aware lock, document expiry reminders, and messages shared by procurement;
- full EN/AR, RTL tracker, vertical tracker on phones, dark mode.

**Found while building it**
- **Security:** `StatusHistory`, `Comments` and `ReviewFlags` in `ApplicantService` had no ownership filter, so any supplier could read every supplier's timeline and shared messages. They now carry `@restrict where: 'application.createdBy = $user'`, and history no longer exposes reviewer notes or identities to suppliers. Tests create a shared comment and flags first, then check the owner sees them and another supplier doesn't. (A first version of these tests passed against the leaky code because the seed data had no comments, so they proved nothing. Lesson: a privacy test needs data to leak.)
- **Flaky ordering:** CAP's managed `createdAt` is the *transaction* time, so APPROVED and REGISTERED, written in one request, shared a timestamp and sorted randomly (an intermittent test failure, and a wrong timeline). History now stores the wall-clock time.
- The wizard showed the reviewer's old change request even after the supplier withdrew voluntarily. The note now shows only while changes are actually requested.
- `requirements()` returned raw `{0}` placeholders when the client sent no `Accept-Language`. It now falls back to the default language.
- UI5 date skeletons need canonical symbol order (`MMMMEEEEd`, not `EEEEdMMMM`).
- `NavContainer` auto-focuses the new page, which drew focus rings without any keyboard use. Turned off.

## Phase 8: Deploy to SAP BTP

**Built:** a live deployment on the ap21 trial: <https://85cc730atrial-dev-tasjeel.cfapps.ap21.hana.ondemand.com>
- **One MTA (`mta.yaml`):**
  - CAP service (HANA Cloud through an HDI container) and an HDI deployer for tables and demo data;
  - standalone approuter as the public entry point;
  - both UI apps zipped into the HTML5 Application Repository (`scripts/build-ui.mjs`, no UI5 tooling needed);
  - destinations for the backend and for Work Zone;
  - connectivity, reserved for Phase 9.
- **The same UI build runs in every environment:** the apps call the backend with app-relative URLs (`odata/…`, `rest/…`). Each app's `xs-app.json` routes them to the `tasjeel-srv-api` destination, and locally `@sap/cds-fiori` plus a small `srv/server.js` map them back.
- **Verified in Brave** under a real SAP ID with `Tasjeel_Admin`:
  - dashboard on live HANA data;
  - inbox and detail views;
  - "Start review" writes through approuter CSRF into HANA, and the history records the SAP ID;
  - the Fiori Elements vendor list;
  - the S/4 panel shows both systems offline (no destinations yet) without breaking the page;
  - the backend URL alone returns 401 without a token.

**Concepts**
- **MTA build and deploy:** `mbt build` runs `cds build --production` (gen/srv, gen/db), packages modules, then `cf deploy` creates or updates services, binds them, stages apps and runs the HDI deployer as a CF task.
- **HDI on HANA Cloud:** the `hana`/`hdi-shared` broker needs a HANA Cloud database *visible to the CF space*. Creating the database with `cf create-service hana-cloud hana-free … -c '{"data":{…}}'` puts it straight into the space; a database created in HANA Cloud Central needs an instance mapping instead.
- **HTML5 repository:** apps are served at `/<sap.app.id without dots>/` (`/tasjeelportal/`). The router hands everything to `html5-apps-repo-rt`, which then applies the app's own `xs-app.json`.
- **Destinations from an MTA:**
  - service-instance destinations (HTML5 repo host, XSUAA with `sap.cloud.service`) go in a `com.sap.application.content` module;
  - plain URL destinations go in the destination service's `init_data`.
- **Resumable deploys:** a failed `cf deploy` stays as an operation that can be resumed (`-a retry`) or aborted. `-m <module>` redeploys a single module, e.g. only the UI content.

**Bugs found by deploying**
- "No database available in space dev": HANA wasn't mapped to the space, so it was recreated in the space via the CF CLI.
- The SAP HANA Cloud tools subscription failed on the trial ("try again"). The CLI route above makes it unnecessary.
- "Missing destination property ServiceInstanceName": the backend URL destination was in the content module. Moved it to `init_data`.
- The portal's "Vendors" link used the local folder path. It's now environment-aware: a launchpad intent, the sibling HTML5 app, or the local folder.
- Seed documents have metadata but no file content (CSV can't carry binaries), so their preview is empty. Uploaded documents work.
