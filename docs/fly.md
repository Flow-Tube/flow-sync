# Fly.io

The Docker image on one machine with SQLite on a Fly volume, from [fly.toml](../deploy/fly/fly.toml).

## Deploy

From the repository root, with the Fly CLI:

```sh
fly apps create <app>
fly volumes create flow_sync_data --app <app> --region ams --size 1
fly secrets set --app <app> FLOW_SYNC_ADMIN_TOKEN="$(openssl rand -hex 32)"
fly deploy --app <app> -c deploy/fly/fly.toml --dockerfile deploy/docker/Dockerfile --ha=false
```

Use the same region for the volume and `primary_region` in `fly.toml`. `--ha=false` keeps a single machine, since a volume belongs to one machine.

## Limits

- No free tier for new organizations. A shared machine with 256 MB is about $2 a month, plus $0.15 per GB of volume.
- Volumes aren't replicated. Fly keeps 5 days of snapshots.

## Not verified

The image is tested in CI. The project hasn't deployed to Fly yet. Fly gives a new volume to the image's user, according to Fly's staff, which the unprivileged image needs.
