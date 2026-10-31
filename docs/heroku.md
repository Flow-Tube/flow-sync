# Heroku

The Docker image on a web dyno, with everything stored in Heroku Postgres. Heroku has been in sustaining engineering since February 2026, so treat this host as a maintenance risk.

## Deploy

With the Heroku CLI and Docker:

```sh
heroku create <app> --stack container
heroku addons:create heroku-postgresql:essential-0 --app <app>
heroku config:set --app <app> PGSSLMODE=no-verify FLOW_SYNC_TRUST_PROXY=1 \
  FLOW_SYNC_ADMIN_TOKEN="$(openssl rand -hex 32)"
heroku container:login
deploy/heroku/release.sh <app>
```

[release.sh](../deploy/heroku/release.sh) builds the image from [deploy/docker/Dockerfile](../deploy/docker/Dockerfile), pushes it and releases it. `PGSSLMODE=no-verify` is needed because Heroku Postgres certificates don't verify against public roots.

## Limits

- A Basic dyno plus Essential Postgres is about $10 a month. Eco dynos sleep after 30 minutes, which drops live connections.
- The router closes requests that send no first byte within 30 s and idle connections after 55 s; the apps ping the live socket well within that.

## Not verified

The image and the Postgres storage are tested in CI. The project hasn't deployed to Heroku yet.
