-- Run only after both scheduler Edge Functions and all four Vault values have
-- been configured. This file intentionally schedules dry runs. Activating
-- deletion requires the separate, commented statements at the bottom.
--
-- Required Vault secret names:
--   STOCKLY_PROJECT_URL
--   STOCKLY_PUBLISHABLE_KEY
--   RECIPE_IMPORT_CLEANUP_SECRET
--   ACCOUNT_PURGE_SECRET
--
-- Example secret creation must be performed interactively in the Dashboard or
-- SQL editor. Never replace the placeholders in a committed file.
-- select vault.create_secret('<project-url>', 'STOCKLY_PROJECT_URL');
-- select vault.create_secret('<publishable-key>', 'STOCKLY_PUBLISHABLE_KEY');
-- select vault.create_secret('<generated-secret>', 'RECIPE_IMPORT_CLEANUP_SECRET');
-- select vault.create_secret('<different-generated-secret>', 'ACCOUNT_PURGE_SECRET');

do $$
declare
  required_secret text;
begin
  foreach required_secret in array array[
    'STOCKLY_PROJECT_URL',
    'STOCKLY_PUBLISHABLE_KEY',
    'RECIPE_IMPORT_CLEANUP_SECRET',
    'ACCOUNT_PURGE_SECRET'
  ]
  loop
    if not exists (
      select 1
      from vault.decrypted_secrets secret
      where secret.name = required_secret
        and nullif(secret.decrypted_secret, '') is not null
    ) then
      raise exception 'Vault secret % is missing.', required_secret;
    end if;
  end loop;
end
$$;

select cron.schedule(
  'stockly-recipe-import-cleanup-dry-run',
  '10 18 * * *',
  $request$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'STOCKLY_PROJECT_URL'
      ) || '/functions/v1/recipe-import-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'STOCKLY_PUBLISHABLE_KEY'
        ),
        'x-cleanup-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'RECIPE_IMPORT_CLEANUP_SECRET'
        )
      ),
      body := '{"dryRun":true}'::jsonb
    ) as request_id;
  $request$
);

select cron.schedule(
  'stockly-account-purge-dry-run',
  '30 18 * * *',
  $request$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'STOCKLY_PROJECT_URL'
      ) || '/functions/v1/account-purge-scheduler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'STOCKLY_PUBLISHABLE_KEY'
        ),
        'x-account-purge-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'ACCOUNT_PURGE_SECRET'
        )
      ),
      body := '{"dryRun":true}'::jsonb
    ) as request_id;
  $request$
);

-- Activation gate (do not run until isolated test data deletion and retry have
-- been verified). Because cron.schedule overwrites a same-named job, use these
-- statements to replace each dry-run body with `{"dryRun":false}` while
-- keeping the same KST schedules.
--
-- select cron.schedule('stockly-recipe-import-cleanup-dry-run', '10 18 * * *',
--   replace((select command from cron.job where jobname = 'stockly-recipe-import-cleanup-dry-run'),
--     '{"dryRun":true}', '{"dryRun":false}'));
-- select cron.schedule('stockly-account-purge-dry-run', '30 18 * * *',
--   replace((select command from cron.job where jobname = 'stockly-account-purge-dry-run'),
--     '{"dryRun":true}', '{"dryRun":false}'));
