# Account purge scheduler

Scheduler-only Edge Function. It requires `x-account-purge-secret` to match the
`ACCOUNT_PURGE_SECRET` Edge secret. Store the same value in Supabase Vault for
`pg_cron`; never place it in client code, Git, request logs, or audit rows.

The default request is a dry run. Send `{ "dryRun": false }` only after the
candidate count has been checked with an isolated test account and personal
test store. Before each deletion the function rechecks the expiry time, store
status, creator, current member count, and owner profile. Failures are isolated
per store and only stable error codes are retained.
