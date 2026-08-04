# DEUCE Pages Backend Skeleton

This is the Express API skeleton for the DEUCE Pages app. It is ready for Render deployment and requires PostgreSQL through `DATABASE_URL`.

## Run Locally

```bash
npm install
npm run dev
```

The API listens on `PORT` or `10000`.

## Database

Run the migration after setting `DATABASE_URL`:

```bash
npm run db:migrate
```

The schema lives in `database/schema.sql` and creates:

- `users`
- `page_packages`
- `package_versions`
- `user_pages`
- `wallet_transactions`
- `page_results`
- `traffic_events`

The repository layer lives in `src/repositories/appRepository.js`. Routes call that layer and all app records are read from PostgreSQL.

## Render

`render.yaml` defines:

- Node web service: `deuce-pages-api`
- Render PostgreSQL database: `deuce-pages-db`
- Start command: `npm start`

Set these environment variables in Render:

```txt
APP_BASE_URL=https://deucetoolkit.cloud
PUBLIC_BASE_URL=https://deucetoolkit.cloud
PORTAL_BASE_URL=https://deucetoolkit.cloud
PREVIEW_BASE_URL=https://preview.deucetoolkit.cloud
API_BASE_URL=https://deucetoolkit.cloud
CORS_ORIGINS=https://deucetoolkit.cloud
JWT_SECRET=
DATABASE_URL=
```

Add both `deucetoolkit.cloud` and `preview.deucetoolkit.cloud` as custom domains
on the same Render web service. Point the DNS record Render supplies for the
preview hostname to that service. Do not add the preview origin to
`CORS_ORIGINS`; browser navigation works without CORS and preview responses are
intentionally unreadable from other origins.

The preview hostname exposes only one-time preview-session routes. A signed-in
user requests a launch with `POST /api/packages/:id/preview-session`, follows a
90-second single-use exchange URL, then receives an HttpOnly host-only preview
cookie lasting at most 15 minutes. The preview is also invalidated when its
parent portal session ends. Imported HTML is served with a CSP sandbox and
cannot reach the portal API or portal cookie.

If `PREVIEW_TURNSTILE_SITE_KEY` is configured, allow
`preview.deucetoolkit.cloud` in that Turnstile widget's hostname settings.

## Current Routes

Auth:

```txt
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/me
```

Packages:

```txt
GET   /api/packages
POST  /api/admin/packages
GET   /api/admin/packages/:id
PATCH /api/admin/packages/:id
POST  /api/admin/packages/:id/publish
GET   /api/packages/:id/asset
POST  /api/packages/:id/preview-session
POST  /api/packages/:id/subscribe
```

GitHub import:

```txt
POST /api/admin/import/github/scan
POST /api/admin/import/github/package
```

Public repositories can be scanned without extra setup. For private repositories, set `GITHUB_TOKEN` in Render.

User pages:

```txt
GET    /api/user-pages
GET    /api/user-pages/:id
PATCH  /api/user-pages/:id/config
PATCH  /api/user-pages/:id/security
POST   /api/user-pages/:id/ban-ip
POST   /api/user-pages/:id/whitelist-ip
POST   /api/user-pages/:id/generate-index
GET    /api/user-pages/:id/results
DELETE /api/user-pages/:id/results/:resultId
```

Wallet:

```txt
GET  /api/wallet
POST /api/wallet/deposit
GET  /api/wallet/transactions
POST /api/wallet/admin-adjust
```

Generated index.html runtime:

```txt
POST /api/page-security/check
POST /api/page-traffic
POST /api/page-results
```

## Next Backend Step

Add authentication middleware that validates stored session tokens, then seed the first admin user/package records into PostgreSQL.
