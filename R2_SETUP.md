# Cloudflare R2 local imports

Create a private R2 bucket and an R2 API token with Object Read & Write permission for that bucket. Configure these variables on Render:

```text
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_ACCESS_KEY_ID=<R2 token access key>
R2_SECRET_ACCESS_KEY=<R2 token secret>
R2_BUCKET_NAME=deuce-page-packages
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
LOCAL_IMPORT_TOKEN_SECRET=<long random secret>
LOCAL_IMPORT_MAX_ZIP_MB=25
LOCAL_IMPORT_MAX_FILE_MB=20
LOCAL_IMPORT_MAX_PACKAGE_MB=100
LOCAL_IMPORT_MAX_FILES=500
```

Keep the bucket private. Do not enable `r2.dev` public access.

Apply this bucket CORS policy, replacing the origins with the production dashboard and any local development origin you use:

```json
[
  {
    "AllowedOrigins": [
      "https://deuce-pages.onrender.com",
      "http://localhost:10000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The application issues ten-minute presigned upload URLs. R2 credentials remain on the server. Finalization verifies every loose object or ZIP entry, rejects PHP and unsafe paths, requires a root `index.html`, and then saves the package manifest in PostgreSQL.
