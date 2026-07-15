# Railway Deploy + First Page Upload

This app is now set up for Railway with Express, PostgreSQL, migrations, and a GitHub page importer.

## 1. Create Railway project

1. Push this repo to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Add a PostgreSQL service in the same Railway project.
4. In the web service variables, make sure `DATABASE_URL` is available from the PostgreSQL service.

Railway provides `PORT` automatically. The app already reads it in `src/server.js`.

## 2. Set app variables

Set these on the Railway web service:

```txt
NODE_ENV=production
APP_BASE_URL=https://your-railway-app.up.railway.app
API_BASE_URL=https://your-railway-app.up.railway.app
CORS_ORIGINS=https://your-railway-app.up.railway.app
```

For private GitHub page repos, also set:

```txt
GITHUB_TOKEN=your_github_token
```

## 3. Deploy

`railway.json` handles:

```txt
preDeployCommand = npm run db:migrate
startCommand     = npm start
healthcheckPath  = /api/health
```

After deploy, open:

```txt
https://your-railway-app.up.railway.app/api/health
```

You should see `{ "ok": true }`.

## 4. Create your admin/account

Open the app URL and use the signup page. This creates a real user in PostgreSQL.

## 5. Import the first GitHub page

Open Railway Shell for the web service and run:

```bash
FIRST_PAGE_REPO_URL=https://github.com/owner/repo.git \
FIRST_PAGE_BRANCH=main \
FIRST_PAGE_NAME="First Page" \
FIRST_PAGE_SLUG=first-page \
FIRST_PAGE_PUBLISH=true \
npm run page:import:first
```

For your first connected page, replace the repo URL and name with the page you own and are authorized to publish.

The importer will:

- scan HTML/CSS/assets from GitHub
- create or update a `page_packages` record
- store screens, CSS files, files, and GitHub metadata
- publish the package if `FIRST_PAGE_PUBLISH=true`

## 6. Confirm in app

Refresh the app:

1. Go to `Pages`.
2. The published package should appear.
3. Subscribe from wallet after funding the user.
4. Go to `My Pages`.
5. Use `Go Live` to add domain and server/cPanel IP.
6. Download `index.html`.

## Important

Only import pages you own or have permission to operate. Do not publish pages that imitate third-party services or collect credentials for accounts you do not control.
