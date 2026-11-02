# Self-hosting

The same server runs on every host below. Pick one, follow its guide, then claim the instance from Flow with the admin token. The server only ever stores ciphertext: whoever runs it can't read your data.

| Host | Storage | Live (handoff, remote control) | Cost | Guide |
|---|---|---|---|---|
| Docker (VPS, Synology, Unraid, TrueNAS) | SQLite on a volume | yes | your hardware | [deploy/docker](../deploy/docker/README.md) |
| Cloudflare Workers | D1 + R2, live on a Durable Object | yes | free, or $5/month | [cloudflare.md](cloudflare.md) |
| Vercel | Postgres (Neon) + Vercel Blob | no | free (Hobby, non-commercial) | [vercel.md](vercel.md) |
| Netlify | Netlify Database + Netlify Blobs | no | free credits, or $9/month | [netlify.md](netlify.md) |
| Heroku | Heroku Postgres | yes | about $10/month | [heroku.md](heroku.md) |
| Railway | SQLite on a volume | yes | $5/month with usage | [railway.md](railway.md) |
| Render | Render Postgres | yes | about $13/month | [render.md](render.md) |
| Fly.io | SQLite on a volume | yes | about $2/month plus storage | [fly.md](fly.md) |

Without live features, the apps hide "Play on" and remote control unless the devices share a network.

Only the Docker image is built and run in CI. The other templates are tested against local emulators where one exists, but none has been deployed to its host by the project yet. Each guide says what that means for it.

Settings shared by every host (admin token, quota, security contact) are listed in the [Docker guide](../deploy/docker/README.md#settings).

[asvs.md](asvs.md) and [api-top-10.md](api-top-10.md) map the server and these templates to OWASP ASVS 5.0 Level 2 and the OWASP API Security Top 10.

[recovery.md](recovery.md) covers losing devices, the recovery key, or the server.
