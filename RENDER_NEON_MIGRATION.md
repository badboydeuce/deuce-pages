# Move DEUCE PAGES to a new Render service and Neon

The application already uses PostgreSQL through `DATABASE_URL`. Use Neon's **pooled** connection string for the Render web service and Neon's **direct** connection string for the one-time restore when available.

Do not commit either downloaded environment file or any database URL. `.env` is already ignored by Git.

## 1. Prepare Neon

1. Create the Neon project, database, and production branch.
2. Copy both connection strings from Neon:
   - pooled connection string: use as the new Render `DATABASE_URL`;
   - direct connection string: use for `pg_restore` below.
3. Keep `sslmode=require` in the Neon URLs.

## 2. Copy the current Render PostgreSQL database

Install PostgreSQL client tools so `pg_dump`, `pg_restore`, and `psql` are available. In PowerShell, set the URLs only for the current terminal:

```powershell
$env:OLD_DATABASE_URL = "<old Render external database URL>"
$env:NEON_DIRECT_DATABASE_URL = "<Neon direct database URL>"
```

Pause writes to the old service before the final dump. Then create and verify the backup:

```powershell
pg_dump --dbname=$env:OLD_DATABASE_URL --format=custom --no-owner --no-acl --file=deuce-pages.dump
pg_restore --list deuce-pages.dump
```

Restore into an empty Neon database:

```powershell
pg_restore --dbname=$env:NEON_DIRECT_DATABASE_URL --no-owner --no-acl --exit-on-error deuce-pages.dump
psql $env:NEON_DIRECT_DATABASE_URL -c "SELECT COUNT(*) AS users FROM users;"
psql $env:NEON_DIRECT_DATABASE_URL -c "SELECT COUNT(*) AS pages FROM user_pages;"
```

The app also runs `database/schema.sql` at startup. That migration is safe after the data has been restored because its schema operations are idempotent.

## 3. Create the new Render web service

Create the service from this repository and `render.yaml`. Set `DATABASE_URL` manually to the Neon **pooled** connection string.

Import the downloaded environment variables, then change these values to the new public Render URL (no trailing slash):

- `APP_BASE_URL`
- `API_BASE_URL`
- `RUNTIME_API_BASE_URL`
- `PUBLIC_BASE_URL`
- `PORTAL_BASE_URL`
- `PREVIEW_BASE_URL` when previews use the same host
- `CORS_ORIGINS`

Keep all security and integration secrets exactly the same during migration, especially:

- `JWT_SECRET`
- `RESULT_CAPTURE_SECRET`
- `CHALLENGE_PROOF_SECRET`
- `LOCAL_IMPORT_TOKEN_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_SECRET`
- Turnstile, GitHub, Telegram, R2, and wallet values

Set `LOCAL_JSON_DB=false`. Do not copy Render-provided variables such as `RENDER`, `RENDER_SERVICE_ID`, `RENDER_EXTERNAL_URL`, or `PORT`; the new service supplies those itself.

The expected commands are:

```text
Build: npm install
Start: npm run start:render
Health check: /api/health
```

## 4. Verify before cutover

Check the new service directly:

1. `/api/health` returns a successful response.
2. Admin and subscriber login work.
3. Existing pages, subscriptions, results, traffic, and wallet balances are present.
4. R2-backed assets and package previews load.
5. A test result reaches the dashboard and Telegram, if enabled.

## 5. Update external traffic

After the new service passes verification:

1. Reinstall or update the Cloudflare Worker for every live page from Go Live. Existing Workers contain the old backend URL. Users do not need a new `index.html` when the page continues using the same Worker domain.
2. Update the GitHub webhook target to the new Render URL.
3. Reconfigure the Telegram webhook. With `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=true`, restart the new service and verify the webhook.
4. Move any custom domain to the new Render service, then update the base URL variables to that stable domain if used.
5. Keep the old Render service and database available but read-only until the new deployment has been verified.

## 6. Clean up securely

Remove the temporary terminal variables and backup after the rollback window:

```powershell
Remove-Item Env:OLD_DATABASE_URL
Remove-Item Env:NEON_DIRECT_DATABASE_URL
```

Delete `deuce-pages.dump` only after confirming the Neon data and deciding that the backup is no longer needed. Rotate any credential that was accidentally shared, logged, or committed.
