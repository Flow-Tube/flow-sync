# Self-hosting

The same server runs on every host below. Pick one, follow its guide, then claim the instance from Flow with the admin token. The server only ever stores ciphertext: whoever runs it can't read your data.

| Host | Storage | Live (handoff, remote control) | Cost | Guide |
|---|---|---|---|---|
| Docker (VPS, Synology, Unraid, TrueNAS) | SQLite on a volume | yes | your hardware | [deploy/docker](../deploy/docker/README.md) |
| Linux with systemd, no Docker | SQLite | yes | your hardware | [bare-metal.md](bare-metal.md) |
| Cloudflare Workers | D1 + R2, live on a Durable Object | yes | free, or $5/month | [cloudflare.md](cloudflare.md) |
| Vercel | Postgres (Neon) + Vercel Blob | no | free (Hobby, non-commercial) | [vercel.md](vercel.md) |
| Netlify | Netlify Database + Netlify Blobs | no | free credits, or $9/month | [netlify.md](netlify.md) |
| Heroku | Heroku Postgres | yes | about $10/month | [heroku.md](heroku.md) |
| Railway | SQLite on a volume | yes | $5/month with usage | [railway.md](railway.md) |
| Render | Render Postgres | yes | about $13/month | [render.md](render.md) |
| Fly.io | SQLite on a volume | yes | about $2/month plus storage | [fly.md](fly.md) |

Without live features, the apps hide "Play on" and remote control unless the devices share a network.

The Docker image is built and run in CI. Cloudflare Workers, Vercel and Netlify were deployed by the maintainer on 31 October 2026 and work. Heroku, Railway, Render and Fly.io are templates tested against the same image, but haven't been deployed to their hosts yet. Each guide says what was verified.

## Use a release

Deploy a release, not `main`, which can hold changes no app speaks yet.

The Docker guide downloads its files from the latest release. For hosts you deploy from a clone (Cloudflare Workers, Heroku, Fly.io), check out the latest release tag:

```sh
git clone https://github.com/Flow-Tube/flow-sync && cd flow-sync
git checkout "$(git describe --tags --abbrev=0 origin/main)"
```

Hosts that build from a repository (Vercel, Netlify, Railway, Render) deploy a branch of your fork. Fork the repository, push a `release` branch at the latest tag, and deploy that branch:

```sh
git clone https://github.com/<you>/flow-sync && cd flow-sync
git remote add upstream https://github.com/Flow-Tube/flow-sync
git fetch upstream --tags
git push origin "$(git describe --tags --abbrev=0 upstream/main)^{commit}:refs/heads/release"
```

To update, run the last two commands again (or `git fetch --tags` and the `checkout` in a clone), then redeploy.

Settings shared by every host (admin token, quota, security contact) are listed in the [Docker guide](../deploy/docker/README.md#settings).

[recovery.md](recovery.md) covers losing devices, the recovery key, or the server.

[security.md](security.md) explains what the server can and can't see, and what its operator is trusted with. [asvs.md](asvs.md) and [api-top-10.md](api-top-10.md) map the server and these templates to OWASP ASVS 5.0 Level 2 and the OWASP API Security Top 10.
