# Railway

The Docker image with SQLite on a Railway volume.

## Deploy

1. Create a service from the repository and set its config file path to `deploy/railway/railway.json`, which builds [deploy/docker/Dockerfile](../deploy/docker/Dockerfile).
2. Attach a volume mounted at `/data`.
3. Set `FLOW_SYNC_ADMIN_TOKEN` to 32 or more random characters, `FLOW_SYNC_TRUST_PROXY=1`, and `RAILWAY_RUN_UID=0`.
4. Generate a public domain for the service.

Railway mounts volumes owned by root, and the image runs as an unprivileged user that can't write there, so `RAILWAY_RUN_UID=0` runs the container as root. Railway isolates each service, but if you'd rather keep the server unprivileged, add Railway Postgres instead of the volume and set `DATABASE_URL` to its connection string.

## Limits

- Hobby is $5 a month including $5 of usage, with volumes up to 5 GB and one volume per service.
- A redeploy briefly stops the server and closes live connections.

## Not verified

The image is tested in CI. The project hasn't deployed to Railway yet, and the volume ownership advice comes from Railway's community answers.
