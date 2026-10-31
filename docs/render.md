# Render

The Docker image with everything stored in Render Postgres, from the [render.yaml](../deploy/render/render.yaml) Blueprint.

Render mounts persistent disks owned by root, and the image runs as an unprivileged user without a shell to change that, so this template uses Postgres rather than SQLite on a disk.

## Deploy

1. Create a Blueprint from the repository with the Blueprint path `deploy/render/render.yaml`.
2. Render creates the web service and the database and generates `FLOW_SYNC_ADMIN_TOKEN`. Copy the token from the service's environment to claim the instance.

## Limits

- The Starter web service and the smallest paid database cost about $13 a month.
- The free tier can't keep data: free web services have no disk and free databases expire after 30 days.

## Not verified

The image and the Postgres storage are tested in CI. The project hasn't deployed to Render yet.
