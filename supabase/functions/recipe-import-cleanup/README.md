# Recipe import cleanup

Scheduler-only Edge Function. It requires `x-cleanup-secret` to match the
`RECIPE_IMPORT_CLEANUP_SECRET` Edge secret. The same value must be stored in
Supabase Vault for `pg_cron`; never place it in client code or Git.

The default request is a dry run. Send `{ "dryRun": false }` only after the
candidate count has been checked with test objects.
