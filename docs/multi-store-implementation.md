# Multi-store implementation checklist

## Completed in this pass

- Added a draft migration for stores, profile roles, store-scoped columns, store invites, and store-scoped RLS.
- Added link-based invites with `store_invites.token`.
- Added invite acceptance RPC: `accept_store_invite(invite_token text)`.
- Added invite creation RPC: `create_store_invite(target_email text, target_role profile_role)`.
- Added public entry screens for landing, signup request placeholder, and invite acceptance.
- Added role-aware route gates for `master`, `store_admin`, and `staff`.
- Added a staff management page that creates copyable invite links.

## Required before production use

- Apply the migration to a test Supabase project first.
- Regenerate `src/types/supabase.ts` from Supabase after the migration is applied.
- Update every insert into store-scoped tables to include `store_id`.
- Update every query to add `.eq("store_id", profile.store_id)` where practical, even though RLS is the final guard.
- Rework `merge_products`, `restore_inventory_to_log`, `delete_today_product_receipts`, and `restore_latest_dashboard_receipt_deletion` to validate `store_id` inside the function body.
- Rework store closure functions to accept or derive `store_id`.
- Build the master store management UI.
- Build master user management and store admin assignment.
- Replace the signup request placeholder with a real request or approval flow.
- Add RLS tests that confirm one store cannot read or mutate another store's data.

## Invite link format

Invite links are designed to be copied into any messenger:

```text
https://your-domain.com/invite/{token}
```

The accepting user must be logged in with the same email address that was invited.
