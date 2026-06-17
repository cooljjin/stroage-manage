# Agent handoff: multi-store inventory app

## Project context

This is a Vite + React + Supabase inventory management app.

Repository path:

```text
/Users/jinkim/Documents/storage manage
```

Production URL:

```text
https://stroage-manage.vercel.app
```

GitHub remote:

```text
https://github.com/cooljjin/stroage-manage.git
```

Current main branch includes the latest pushed work:

```text
9b59bce Add master user management
7d1f1b5 Add master store creation
98a674b Add multi-store roles and invite flow
```

## What was already done

### Database

The Supabase production database has already been migrated for multi-store support.

Applied migrations:

- `supabase/migrations/012_multi_store_roles_and_invites.sql`
- `supabase/migrations/013_master_profile_delete_policy.sql`

Important database additions:

- `stores`
- `store_invites`
- `profiles.store_id`
- `profiles.role`
- `profiles.invited_by`
- `profile_role` enum: `master`, `store_admin`, `staff`
- Store-scoped `store_id` columns on the main inventory tables
- RLS helpers:
  - `current_store_id(user_id uuid)`
  - `current_role(user_id uuid)`
  - `is_master(user_id uuid)`
  - `is_store_admin(user_id uuid)`
  - `can_access_store(target_store_id uuid)`
  - `can_admin_store(target_store_id uuid)`
- Invite RPCs:
  - `create_store_invite(target_email text, target_role profile_role)`
  - `accept_store_invite(invite_token text)`

The master account has also been set:

```text
jich980611@gmail.com
```

Do not put Supabase access tokens in files. A token was used during setup and should be considered sensitive.

### Frontend

Implemented screens:

- `src/pages/LandingPage.tsx`
- `src/pages/InviteAcceptPage.tsx`
- `src/pages/SignupRequestPage.tsx`
- `src/pages/StaffManagementPage.tsx`
- `src/pages/MasterStoresPage.tsx`
- `src/pages/MasterUsersPage.tsx`

Implemented behavior:

- Public landing page
- Invite link entry via `/invite/{token}`
- Role-aware app routing in `src/App.tsx`
- Role-aware top menu in `src/components/TopMenu.tsx`
- Master-only store creation
- Master-only full user list grouped by store
- Master user name edit
- Master user profile delete
- Store admin staff invite link generation

## Important security model

Do not rely only on frontend route checks.

The real access control is Supabase RLS:

- `master` can access all stores.
- `store_admin` can manage users/settings in their own store.
- `staff` can use operational inventory screens for their own store.
- Store-scoped data should always have `store_id`.

The migration includes triggers that fill `store_id` from the logged-in user's profile on inserts. This keeps older insert code from immediately breaking. Still, future work should explicitly pass or filter by `store_id` where practical.

## Current limitations and next work

### 1. Store edit UI

`MasterStoresPage` currently supports:

- List stores
- Create a store with a name

Still needed:

- Rename store
- Edit business name
- Change status: active/inactive
- Optional: store detail page

Relevant files:

- `src/pages/MasterStoresPage.tsx`
- `src/types/domain.ts`
- `src/types/supabase.ts`

### 2. Assign store admins

`MasterUsersPage` currently supports:

- View users grouped by store
- Edit display name
- Delete profile

Still needed:

- Change user role
- Move user to another store
- Assign a store admin to a newly created store
- Prevent accidental removal of the last master account

Relevant file:

- `src/pages/MasterUsersPage.tsx`

### 3. Store admin staff management

`StaffManagementPage` currently supports:

- Create invite link for `staff` or `store_admin`
- View current store profiles
- Edit display names

Still needed:

- Revoke pending invites
- Show pending invite list
- Change role within the store
- Delete staff from the store, if desired

Relevant file:

- `src/pages/StaffManagementPage.tsx`

### 4. Store-scoped frontend queries

RLS protects data, but frontend queries should still be tightened for clarity and performance.

Next agent should gradually update pages to include store context where needed:

- `HomePage`
- `ScanPage`
- `InventoryListPage`
- `ProductRegisterPage`
- `ProductEditPage`
- `InventoryOperationPage`
- `LowStockPage`
- `LogsPage`
- `ProductManagementPage`
- `CategoryManagementPage`
- `SupplierManagementPage`
- `SettingsPage`

Use RLS as final protection, but add `.eq("store_id", profile.store_id)` where practical after passing profile/store context down cleanly.

### 5. Security-definer functions

These functions should be reviewed and hardened to validate `store_id` internally:

- `merge_products`
- `restore_inventory_to_log`
- `delete_today_product_receipts`
- `restore_latest_dashboard_receipt_deletion`
- Store closure functions:
  - `is_store_closed`
  - `next_store_business_date`
  - `move_future_dashboard_items_from_closures`

They are `security definer`, so they can bypass normal RLS if not carefully scoped.

## Development commands

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run lint
npm run build
```

Run local dev server:

```bash
npm run dev
```

## Deployment notes

Pushing to `main` triggers the Vercel deployment for:

```text
https://stroage-manage.vercel.app
```

After pushing, verify the deployed `index.html` references the same JS/CSS asset names as local `dist/index.html`.

Example:

```bash
curl -sS -L https://stroage-manage.vercel.app | rg 'assets/index-[^"]+\\.(js|css)' -o
sed -n '1,40p' dist/index.html | rg 'assets/index-[^"]+\\.(js|css)' -o
```

## Working from only local files

Yes, another coding agent can continue from local files.

However, actions that need remote systems still require credentials or an already authenticated environment:

- Applying Supabase migrations
- Querying Supabase production data
- Deploying directly through Vercel CLI
- Pushing to GitHub

If those credentials are unavailable, the agent can still modify code locally, run lint/build, and prepare commits.
