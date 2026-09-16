# Stockly Staging Environment Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Create an isolated, persistent staging environment so the development TestFlight app can validate schema, Edge Function, and real iPhone barcode flows without accessing production data; keep the staff TestFlight app on production.

**Architecture:** Use three tiers only: local Supabase for disposable automated tests, one new persistent Supabase staging project for integration/device testing, and the existing linked project (`pcvpkndyqkljgbrvssza`) as production. Build-time Vite environment files choose the API endpoint; no in-app environment selector is added. The existing iOS schemes remain the channel boundary: `App` / `com.jinkim.stockly` is staging, and `Stockly Staff` / `com.jinkim.storeinventory.poc` is production.

**Tech Stack:** Supabase CLI migrations and Edge Functions, Vite modes, npm scripts, Capacitor 8, Xcode schemes, TestFlight, existing Node test runner.

---

## Decisions and non-goals

- Create a **separate persistent Supabase project**, not a “테스트 매장” inside production and not a per-PR Supabase branch. It is the smallest solution that isolates schema, Auth, Storage, Functions, and secrets for repeatable iPhone QA.
- Do not copy production users, stores, inventory, Storage objects, auth identities, or Function secrets into staging. Use a named `테스트 매장` and dedicated vault-backed test account only.
- Do not add a runtime server/environment switcher. `VITE_*` values are bundled into Vite output; a runtime switch would create a production-routing footgun.
- Do not deploy 083–087 to production as part of staging setup. Staging is the first target; production promotion remains a separate, explicit release action.
- Do not introduce a long-lived Git staging branch. Existing repository practice is direct work on `main`; staged deployments are selected by explicit build/deploy commands and target guards.

## Preconditions and human gates

1. Confirm a Supabase organization/project budget and create a new project named `stockly-staging` in the same region as production.
2. Record the staging project ref, URL, anon key, and Dashboard access in the local password manager / deployment-secret store. Never commit them.
3. Create a new, independent `PRODUCT_LOOKUP_TOKEN_SECRET` for staging (at least 32 bytes); do not reuse the production value.
4. Confirm Apple signing exists for the already-configured development scheme `App` / `com.jinkim.stockly`. This development app becomes the staging TestFlight channel.
5. Before production promotion, require an explicit user approval after staging evidence is available.

## Task 1: Capture the immutable environment contract

**Objective:** Document the two cloud targets and prevent ambiguity before any credentials or migrations are touched.

**Files:**
- Create: `docs/environments.md`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Step 1: Document the mapping.**

Add one table, using identifiers rather than secrets:

| Environment | Supabase project | iOS scheme | Bundle ID | Data policy |
|---|---|---|---|---|
| staging | `<staging-project-ref>` | `App` | `com.jinkim.stockly` | test-only |
| production | `pcvpkndyqkljgbrvssza` | `Stockly Staff` | `com.jinkim.storeinventory.poc` | operating data |

State that the root `capacitor.config.json` is not the source of truth for staff signing; the Xcode scheme/target controls its bundle ID and plist.

**Step 2: Add release invariants.**

- staging deployments must never use a production URL/ref;
- staff TestFlight archives must never use staging URL/ref;
- production mutations are not valid test verification;
- each Supabase target must have independent Function secrets and Auth redirect configuration.

**Step 3: Review repository instructions for contradictions.**

Correct stale material in `docs/testflight-staff-deployment.md` that identifies `com.jinkim.stockly` as the employee deployment channel; preserve its historical-warning wording where useful.

**Step 4: Verify.**

Run:
```bash
rg "com\.jinkim\.(stockly|storeinventory\.poc)|pcvpkndyqkljgbrvssza" README.md AGENTS.md docs/environments.md docs/testflight-staff-deployment.md
```

Expected: every channel description agrees with the table above.

---

## Task 2: Add build-time environment inputs and an explicit target guard

**Objective:** Make it impossible to accidentally create a staging build with production credentials or a staff build with staging credentials.

**Files:**
- Create: `.env.example`
- Create locally only, ignored: `.env.staging`
- Create locally only, ignored: `.env.production`
- Create: `scripts/prepare-ios-channel.mjs`
- Modify: `package.json`
- Test: `tests/ios-channel-prepare.test.mjs`

**Step 1: Write the failing guard test.**

The test should invoke the script with temporary environment files and assert:

- `staging` accepts only `VITE_DEPLOYMENT_ENV=staging` and `com.jinkim.stockly`;
- `production` accepts only `VITE_DEPLOYMENT_ENV=production` and `com.jinkim.storeinventory.poc`;
- missing URL/key/ref, matching refs across targets, or a channel mismatch exits non-zero before `vite build` or `cap copy` is called;
- no secret values are written to stdout.

Run:
```bash
node --test tests/ios-channel-prepare.test.mjs
```

Expected before implementation: FAIL because the script is absent.

**Step 2: Define the environment-file contract.**

Commit only `.env.example`:

```dotenv
# Copy to .env.staging or .env.production. Do not commit the copies.
VITE_DEPLOYMENT_ENV=staging
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_SUPABASE_PROJECT_REF=<project-ref>
```

`.gitignore` already ignores `.env` and `.env.*`; retain that protection. Do not add service-role keys to any Vite environment file.

**Step 3: Implement the smallest build wrapper.**

`scripts/prepare-ios-channel.mjs` must:

1. accept one positional channel: `staging` or `production`;
2. load only `.env.staging` or `.env.production` without printing values;
3. validate the declared environment and project ref against the channel allow-list supplied by the checked-in non-secret contract;
4. print only `channel`, expected Bundle ID, and a redacted project-ref suffix;
5. run `vite build --mode <channel>` and then `npx cap copy ios` only after validation succeeds.

Keep it a single Node script using built-in `node:fs`, `node:path`, `node:child_process`, and `node:assert`; do not add dotenv or a deployment framework. Vite will load the same selected `.env.<mode>` during its build.

**Step 4: Add scripts.**

Replace ambiguous iOS preparation use with explicit scripts:

```json
"build:staging": "vite build --mode staging",
"build:production": "vite build --mode production",
"ios:prepare:staging": "node scripts/prepare-ios-channel.mjs staging",
"ios:prepare:production": "node scripts/prepare-ios-channel.mjs production"
```

Keep the existing `ios:prepare` temporarily for backward compatibility, but mark it deprecated in documentation and do not use it for TestFlight.

**Step 5: Verify.**

Run:
```bash
node --test tests/ios-channel-prepare.test.mjs
npm run build:staging
npm run build:production
```

Expected: both builds pass only when their correct ignored local environment files exist; generated bundles contain the expected non-secret `VITE_DEPLOYMENT_ENV` value and the wrong target is rejected before building.

---

## Task 3: Create and bootstrap the staging Supabase project

**Objective:** Give staging an isolated schema and backend equivalent to the repository, without importing production data.

**Files:**
- Modify: `docs/environments.md`
- Modify if needed: `supabase/config.toml`
- No migration files modified or reordered.

**Step 1: Create the project through Supabase Dashboard.**

Human action: create `stockly-staging`, choose the production region, and record its project ref securely. This is an external account/billing action and must not be automated without approval.

**Step 2: Link staging temporarily and inspect before writes.**

```bash
npx supabase link --project-ref <staging-project-ref>
npx supabase migration list --linked
npx supabase functions list
```

Expected: a fresh project has no application migration history and no Stockly Edge Functions. `supabase/.temp/` is ignored; do not commit the temporary link.

**Step 3: Apply repository migrations to staging only.**

```bash
npx supabase db push
npx supabase migration list --linked
```

Expected: local and remote histories match through the latest migration (`087` at this time). If any migration fails, stop; do not repair the production schema or edit historical migrations.

**Step 4: Deploy only the repository Functions enabled in `supabase/config.toml`.**

```bash
npx supabase functions deploy product-lookup
npx supabase functions deploy product-confirm
npx supabase functions deploy manage-account-deletion
npx supabase functions deploy recipe-import
npx supabase functions deploy recipe-import-cleanup
npx supabase functions deploy account-purge-scheduler
npx supabase functions list
```

Set each staging Function secret through the Supabase secret store. At minimum set the new staging `PRODUCT_LOOKUP_TOKEN_SECRET`; set other function-specific secrets only if those functions require them. Never copy the production secret value.

**Step 5: Configure staging Auth independently.**

- Add the development callback `com.jinkim.stockly://auth/callback`.
- Add only the staging web origin when a staging web URL exists.
- Do not add staff/production callbacks to staging unless the staging target explicitly needs them.
- Create the dedicated test account through normal sign-up and connect it to an explicitly named `테스트 매장`.

**Step 6: Verify external state by read-back.**

```bash
npx supabase migration list --linked
npx supabase functions list
```

Expected: migrations including `084` and `087` are present; `product-lookup` and `product-confirm` are `ACTIVE` with JWT verification enabled. Read Auth redirect settings through the Management API/dashboard and record only URL values, never tokens.

---

## Task 4: Add a disposable staging-data bootstrap procedure

**Objective:** Allow repeatable test setup without operational records or a production data copy.

**Files:**
- Create: `supabase/seed.staging.sql`
- Create: `docs/staging-test-data.md`
- Test: `supabase/tests/staging_seed_contract.sql`

**Step 1: Write a rollback-wrapped seed contract.**

The contract should assert that test fixtures use explicit names prefixed `테스트`, belong only to the staging test store, and can create the barcodes needed for the smoke check. It must not assume production IDs or emails.

**Step 2: Implement the minimal seed.**

Add only:

- one `테스트 매장` (or a documented manual creation path if Auth/profile functions make direct seed unsafe);
- a small number of clearly named test products;
- one known registered barcode and one known unregistered but valid GTIN for candidate lookup;
- no real inventory, customer, supplier, staff, or production identifiers.

If the profile/store setup is coupled to Auth, keep account creation manual and seed only fixture products after the test account/store exists. Do not bypass application authorization merely to make seeding convenient.

**Step 3: Verify in a disposable local database first.**

Run the existing catalog and quota SQL contracts plus the new seed contract in the project’s isolated database workflow. Each test transaction rolls back.

**Step 4: Document cleanup.**

The guide must state that all manual testing occurs in staging’s `테스트 매장`, and test products can be deleted/reset there without production approval.

---

## Task 5: Verify the full staging barcode path before any production promotion

**Objective:** Produce evidence that the deployed backend and the actual development iPhone app work together.

**Files:**
- Create: `docs/staging-release-checklist.md`
- Test: reuse `tests/product-lookup-service.test.mjs`, `tests/product-lookup-handler.test.mjs`, `tests/product-confirm-handler.test.mjs`, `tests/product-candidate-ui.test.mjs`, `tests/scan-page-flow.test.mjs`, `supabase/tests/084_product_catalog_contract.sql`, `supabase/tests/087_product_lookup_quota_contract.sql`

**Step 1: Run automated checks.**

```bash
node --test \
  tests/product-lookup-service.test.mjs \
  tests/product-lookup-handler.test.mjs \
  tests/product-confirm-handler.test.mjs \
  tests/product-candidate-ui.test.mjs
node --experimental-loader ./tests/scan-page-loader.mjs --test tests/scan-page-flow.test.mjs
npm run build
npm run lint
```

Expected: no failures; the ScanPage test command must run with its loader rather than silently skip the seven production ScanPage cases.

**Step 2: Run staging browser smoke verification with the dedicated account.**

1. Confirm the selected store is `테스트 매장`.
2. Scan/enter a known registered barcode and confirm navigation to inventory operation.
3. Enter a valid catalog-miss barcode and confirm an external candidate can appear.
4. Accept the candidate and confirm exactly one new test product is created with its barcode.
5. Retry the confirmation and confirm no duplicate product is created.
6. Use a no-result barcode and confirm manual registration remains usable.

**Step 3: Run the required human iPhone check.**

Archive/install the `App` scheme only after `npm run ios:prepare:staging` succeeds. On a real iPhone with the staging test account:

1. grant camera permission and scan a physical EAN-13/UPC barcode;
2. accept/save the returned candidate;
3. rescan it and confirm it opens the existing product operation, not registration;
4. verify in the app or staging DB that all created records are in `테스트 매장` only.

Real-device verification is mandatory for each release that changes scanner/native bridge, iOS packaging, Auth redirect behavior, or barcode lookup/confirmation. It is not necessary for a documentation-only change.

**Step 4: Record evidence and declare the gate.**

Use the checklist to record migration parity, active function versions, test command results, iOS scheme/bundle ID, and the three observed device outcomes. Do not record credentials, tokens, or production data. Production promotion is blocked until every required checkbox passes.

---

## Task 6: Make production promotion a separate, explicit release

**Objective:** Ensure successful staging verification does not silently mutate the operating system.

**Files:**
- Modify: `docs/environments.md`
- Modify: `docs/testflight-staff-deployment.md`

**Step 1: Define the promotion order.**

```text
staging evidence approved
→ production migration parity check
→ production migration/function deployment
→ read-back of migrations/functions/Auth configuration
→ npm run ios:prepare:production
→ Xcode archive: Stockly Staff / com.jinkim.storeinventory.poc
→ TestFlight processing and target-group verification
```

**Step 2: Require explicit target confirmation in release documentation.**

Before production commands, the operator must state all three:

- project ref is `pcvpkndyqkljgbrvssza`;
- iOS scheme is `Stockly Staff`;
- Bundle ID is `com.jinkim.storeinventory.poc`.

**Step 3: Preserve a conservative rollback policy.**

Database migrations are forward-only. For a bad application archive, restore the prior TestFlight build. For a schema/function failure, stop promotion, keep the previous staff app release live, and make a new forward corrective migration/function version; never delete or rewrite applied production migrations.

---

## Final acceptance criteria

- [ ] A staging Supabase project exists and has no copied production data.
- [ ] Its migrations and enabled Functions match the repository; its secrets and Auth configuration are independent.
- [ ] `com.jinkim.stockly` is built only with staging API values.
- [ ] `com.jinkim.storeinventory.poc` is built only with production API values.
- [ ] The build guard rejects wrong or incomplete targets before a build/copy begins.
- [ ] Existing automated catalog/scan tests pass, including production ScanPage loader tests.
- [ ] The staging TestFlight app passes the three-step real-iPhone barcode acceptance check in `테스트 매장`.
- [ ] Production deployment remains a separate explicit action with read-back verification.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wrong Supabase URL baked into an iOS archive | Explicit `ios:prepare:staging` / `ios:prepare:production` scripts and channel/ref guard before Vite build. |
| Production data leaks into testing | Separate Supabase project; never clone or seed from production. |
| Local link accidentally targets production | Treat `supabase/.temp/` as ephemeral; always run `migration list --linked` and inspect project ref before any `db push`. |
| Staging drifts from production schema/functions | Promotion checklist requires migration parity and Function read-back; release changes flow staging first. |
| Native scanner defect misses browser QA | Minimal human iPhone scan/accept/rescan test is a release gate. |
| A migration impacts operating users | Test in staging first, deploy production only with explicit approval and use forward-only corrective migrations if needed. |
