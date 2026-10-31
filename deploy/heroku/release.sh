#!/bin/sh
# Builds the Docker image and releases it to a Heroku app. Run from the repository root:
#   deploy/heroku/release.sh <app>
set -eu
app="$1"
image="registry.heroku.com/$app/web"
docker build --platform linux/amd64 -f deploy/docker/Dockerfile -t "$image" .
docker push "$image"
heroku container:release web --app "$app"
