# Localhost JSON Test Mode

Use this mode when you want to test signup, login, wallet, GitHub imports, and page publishing locally without PostgreSQL.

## Config

The local `.env` file should include:

```txt
PORT=10000
NODE_ENV=development
APP_BASE_URL=http://localhost:10000
API_BASE_URL=http://localhost:10000
CORS_ORIGINS=http://localhost:10000,file://
DATABASE_URL=
LOCAL_JSON_DB=true
JSON_DB_PATH=data/local-db.json
GITHUB_TOKEN=
```

The app stores local test data in:

```txt
data/local-db.json
```

That file is ignored by Git.

## Run Localhost

```bash
npm start
```

Open:

```txt
http://localhost:10000
```

## Test Flow

1. Sign up in the app.
2. Go to `Admin`.
3. Open `Import GitHub`.
4. Enter your repo URL.
5. Click `Import & Publish`.
6. Go to `Pages`.

## Import From Command Line

```bash
FIRST_PAGE_REPO_URL=https://github.com/relay1010/ms-live.git \
FIRST_PAGE_BRANCH=main \
FIRST_PAGE_NAME="MS Live" \
FIRST_PAGE_SLUG=ms-live \
FIRST_PAGE_PUBLISH=true \
npm run page:import:first
```

On Windows PowerShell:

```powershell
$env:FIRST_PAGE_REPO_URL="https://github.com/relay1010/ms-live.git"
$env:FIRST_PAGE_BRANCH="main"
$env:FIRST_PAGE_NAME="MS Live"
$env:FIRST_PAGE_SLUG="ms-live"
$env:FIRST_PAGE_PUBLISH="true"
npm run page:import:first
```
