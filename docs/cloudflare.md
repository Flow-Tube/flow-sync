# Cloudflare Workers

Metadata in D1, object bytes in R2, and the live channel on one Durable Object, all from [deploy/cloudflare/wrangler.toml](../deploy/cloudflare/wrangler.toml).

## Deploy

From the repository root, with a Cloudflare account:

```sh
pnpm install --frozen-lockfile
npx wrangler login
npx wrangler r2 bucket create flow-sync
npx wrangler deploy -c deploy/cloudflare/wrangler.toml
openssl rand -hex 32 | tee /dev/stderr | npx wrangler secret put FLOW_SYNC_ADMIN_TOKEN -c deploy/cloudflare/wrangler.toml
```

The deploy creates the D1 database, but not the R2 bucket, which the config names. If R2 isn't enabled on the account yet, enable it once in the dashboard; Cloudflare may ask for a payment method even for the free tier. The last command prints the admin token; keep it to claim the instance from Flow. The first deploy also offers to register a `workers.dev` subdomain; add a custom domain in the dashboard if you'd rather use your own.

## Limits on the Free plan

- 100,000 requests a day, D1 at 500 MB and 100,000 writes a day, Durable Objects at 100,000 requests a day.
- 10 ms of CPU per request. Measured with `pnpm --filter @flow-sync/server bench` on an Apple Silicon Mac: token issue 0.6 ms, object uploads 0.2 to 3.7 ms up to 2.8 MiB, and 5.1 ms for the first request of a new isolate in a 30-device group. Cloudflare's machines may be slower.
- A deploy closes every live connection; the apps reconnect.
- Rate limits are kept per isolate, so they're looser than on a single server. Cloudflare's free rate-limiting rule can add a hard limit in front.

The Workers Paid plan ($5/month) raises all of these.

## Verified

The Worker, D1, R2 and the Durable Object are tested locally in workerd (Miniflare) and bundled with `wrangler deploy --dry-run` in CI. The maintainer deployed it on 31 October 2026 and has synced Flow for Android and Flow Desktop through it since. CPU was measured in Node, not on Cloudflare.
