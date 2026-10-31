# Vercel

Metadata in Postgres (Neon from the Vercel Marketplace) and object bytes in a private Vercel Blob store. Live features are off: Vercel's WebSockets end at the function's time limit and land on separate instances.

## Deploy

1. Import the repository as a Vercel project and set its root directory to `deploy/vercel`, keeping "Include files outside the root directory" on. [deploy/vercel/vercel.json](../deploy/vercel/vercel.json) installs from the repository root.
2. Add a Neon database from the Marketplace. It sets `DATABASE_URL`; use the pooled connection string.
3. Create a Blob store and connect it to the project. It sets `BLOB_READ_WRITE_TOKEN`.
4. Set `FLOW_SYNC_ADMIN_TOKEN` to 32 or more random characters, then deploy.

## Limits

- Request and response bodies are capped at 4.5 MB. The server's largest object is 4 MiB, so it fits.
- Hobby is for non-commercial use. Its Blob store allows 1 GB and a small monthly number of operations, and going over blocks the store for 30 days. A group that syncs often needs Pro.

## Not verified

The entry and the blob adapter are type-checked and bundled, and the entry answers requests in tests. Vercel Blob has no local emulator, so its storage tests run only with a real `BLOB_READ_WRITE_TOKEN`, and the project hasn't deployed to Vercel yet. The root-directory setup above follows Vercel's monorepo docs but hasn't been tried.
