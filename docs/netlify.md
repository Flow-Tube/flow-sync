# Netlify

Metadata in Netlify Database (Postgres) and object bytes in Netlify Blobs with strong consistency. Live features are off: Netlify Functions can't hold WebSockets.

## Deploy

1. Create a site from the repository. Keep the base directory at the repository root and set the package directory to `deploy/netlify`, which holds [netlify.toml](../deploy/netlify/netlify.toml) and the function.
2. Add Netlify Database. It sets `NETLIFY_DATABASE_URL`.
3. Set `FLOW_SYNC_ADMIN_TOKEN` to 32 or more random characters, then deploy. Blobs need no setup.

## Limits

- Buffered function bodies are capped at 6 MB, and binary bodies travel base64-encoded, about 4.5 MB of bytes. The server's largest object is 4 MiB, about 5.6 MB encoded, so it fits.
- When the free credits run out, every project on the account pauses until the next cycle.

## Verified

The Blobs adapter passes the storage tests against Netlify's own local Blobs server, and the entry answers requests in tests. The maintainer deployed it with the steps above on 31 October 2026, and it worked.
