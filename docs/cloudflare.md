# Cloudflare Workers

Metadata in D1, object bytes in R2, and the live channel on one Durable Object, all from [deploy/cloudflare/wrangler.toml](../deploy/cloudflare/wrangler.toml).

## Deploy

From the repository root, with a Cloudflare account:

```sh
pnpm install --frozen-lockfile
npx wrangler login
openssl rand -hex 32 | npx wrangler secret put FLOW_SYNC_ADMIN_TOKEN -c deploy/cloudflare/wrangler.toml
npx wrangler deploy -c deploy/cloudflare/wrangler.toml
```

The first deploy creates the D1 database and the R2 bucket. Add a custom domain in the dashboard if you don't want the `workers.dev` address.

## Limits on the Free plan

- 100,000 requests a day, D1 at 500 MB and 100,000 writes a day, Durable Objects at 100,000 requests a day.
- 10 ms of CPU per request. Measured with `pnpm --filter @flow-sync/server bench` on an Apple Silicon Mac: token issue 0.6 ms, object uploads 0.2 to 3.7 ms up to 2.8 MiB, and 5.1 ms for the first request of a new isolate in a 30-device group. Cloudflare's machines may be slower.
- A deploy closes every live connection; the apps reconnect.
- Rate limits are kept per isolate, so they're looser than on a single server. Cloudflare's free rate-limiting rule can add a hard limit in front.

The Workers Paid plan ($5/month) raises all of these.

## Not verified

The Worker, D1, R2 and the Durable Object are tested locally in workerd (Miniflare) and bundled with `wrangler deploy --dry-run`. Nothing has been deployed to Cloudflare by the project yet, and CPU was measured in Node, not on Cloudflare.
