# Vercel

Metadata in Postgres (Neon from the Vercel Marketplace) and object bytes in a private Vercel Blob store. Live features are off: Vercel's WebSockets end at the function's time limit and land on separate instances.

## Deploy

1. Import your fork as a Vercel project with its `release` branch as the production branch ([how](README.md#use-a-release)), and set its root directory to `deploy/vercel`, keeping "Include files outside the root directory" on. [deploy/vercel/vercel.json](../deploy/vercel/vercel.json) installs from the repository root.
2. Add a Neon database from the Marketplace. It sets `DATABASE_URL`; use the pooled connection string.
3. Create a Blob store and connect it to the project. It sets `BLOB_READ_WRITE_TOKEN`.
4. Set `FLOW_SYNC_ADMIN_TOKEN` to 32 or more random characters, then deploy.

## Limits

- Request and response bodies are capped at 4.5 MB. The server's largest object is 4 MiB, so it fits.
- Hobby is for non-commercial use. Its Blob store allows 1 GB and a small monthly number of operations, and going over blocks the store for 30 days. A group that syncs often needs Pro.

## Verified

The entry and the blob adapter are type-checked and bundled, and the entry answers requests in tests. The maintainer deployed it with the steps above on 31 October 2026, and it worked. Vercel Blob has no local emulator, so its storage tests run in CI only when a `BLOB_READ_WRITE_TOKEN` secret is set, which it isn't yet.
