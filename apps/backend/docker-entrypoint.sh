#!/bin/sh
# The backend process runs as the unprivileged `node` user. The container starts as root for one reason only: the uploads volume
# is a named volume that, on existing installs, was populated by a root-run backend, so `node` could not write new tenant folders
# into it. Fix ownership once (a marker is the top-level owner), then drop privileges for good. exec means PID 1 is the app itself,
# so SIGTERM reaches it and its shutdown hooks run.
set -eu

UPLOADS="${LOCAL_UPLOAD_PATH:-/app/uploads}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOADS"
  NODE_UID="$(id -u node)"
  if [ "$(stat -c %u "$UPLOADS")" != "$NODE_UID" ]; then
    echo "entrypoint: giving $UPLOADS to the node user (one time)"
    chown -R node:node "$UPLOADS"
  fi
  exec su-exec node:node "$0" "$@"
fi

exec "$@"
