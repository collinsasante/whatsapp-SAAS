#!/usr/bin/env bash
# Safeguards that keep a staging release from damaging the hybrid-RAG setup. Sourced by staging-release-deploy.sh; tested by
# tests/staging-hybrid-compose.test.sh. Every function prints a one-line reason to stdout and returns non-zero when a check fails; none of
# them changes anything (they only read files, Docker metadata and, for the extension check, run one SELECT).
#
# What they protect:
#   1. The database image. Staging's PostgreSQL runs the custom pgvector image. Replacing it with stock postgres leaves the already
#      registered `vector` extension without its library, which breaks hybrid retrieval and pg_dump/pg_restore of the vector table. So the
#      Compose file must name the pgvector image, the RUNNING database must already be that image, and the database container must be the
#      very same container after the rollout (a release starts only the five application services, with --no-deps).
#   2. The model and ONNX runtime mounts. They are host directories; the files must exist and the model files must match the pinned SHA-256
#      before anything is stopped, so a missing or corrupt model is found while staging is still running normally.

STAGING_POSTGRES_IMAGE_PREFIX="verzchat-staging/postgres-pgvector:"
STAGING_POSTGRES_CONTAINER="wa_staging_postgres"
STAGING_BACKEND_CONTAINER="wa_staging_backend"
STAGING_MODEL_HOST_DIR="/opt/verz-models/all-MiniLM-L6-v2"
STAGING_ORT_HOST_DIR="/opt/verz-ort"
STAGING_MODEL_MOUNT_TARGET="/models/all-MiniLM-L6-v2"
STAGING_ORT_MOUNT_TARGET="/ort"
# Pinned in apps/backend/src/knowledge-base/rag/local-minilm/minilm-loader.ts; tests/staging-hybrid-compose.test.sh fails if they drift.
STAGING_TOKENIZER_SHA256="da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0"
STAGING_MODEL_SHA256="afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1"

# The image: value of one service in a Compose file (text parse; the file is never interpolated, so no setting is read or printed).
staging_compose_service_image() { # file service
  awk -v svc="  $2:" '$0 == svc {on=1; next} on && /^  [A-Za-z0-9_-]+:/ {exit} on && /^    image:/ {sub(/^    image:[ ]*/, ""); sub(/[ ]*#.*$/, ""); print; exit}' "$1"
}

_sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

# 1a. The Compose file must name the pgvector image for postgres, never a stock one.
staging_check_declared_postgres_image() { # compose-file
  local image; image=$(staging_compose_service_image "$1" postgres)
  [[ -n "$image" ]] || { echo "the Compose file does not name an image for the postgres service"; return 1; }
  [[ "$image" == "$STAGING_POSTGRES_IMAGE_PREFIX"* ]] || { echo "the Compose file names '$image' for postgres; staging requires a $STAGING_POSTGRES_IMAGE_PREFIX* image (a stock image cannot load the registered vector extension)"; return 1; }
  echo "$image"
}

# 1b. The running database must already be the declared image: a release must not be the thing that swaps it.
staging_check_running_postgres_image() { # declared-image
  local running; running=$(docker inspect -f '{{.Config.Image}}' "$STAGING_POSTGRES_CONTAINER" 2>/dev/null) || { echo "cannot read the $STAGING_POSTGRES_CONTAINER container"; return 1; }
  [[ "$running" == "$1" ]] || { echo "the running database image is '$running' but the release declares '$1'. A release never changes the database image: complete the one-time database image procedure in docs/staging-release.md first"; return 1; }
  echo "$running"
}

# 1c. The database container identity (used before and after the rollout; any change means it was recreated).
staging_postgres_container_id() { docker inspect -f '{{.Id}}' "$STAGING_POSTGRES_CONTAINER" 2>/dev/null; }
staging_check_postgres_unchanged() { # id-before
  local now; now=$(staging_postgres_container_id)
  [[ -n "$1" && "$now" == "$1" ]] || { echo "the database container was recreated or replaced during the release (was ${1:0:12}, now ${now:0:12})"; return 1; }
  echo "unchanged"
}

# 1d. The database server must be able to load pgvector (the library is in the image): one read-only SELECT.
staging_check_vector_available() { # db-user db-name
  local n; n=$(docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$STAGING_POSTGRES_CONTAINER" psql -X -U "$1" -d "$2" -At -c "select count(*) from pg_available_extensions where name='vector'" 2>/dev/null)
  [[ "$n" == "1" ]] || { echo "the running database cannot load the vector extension (pg_available_extensions has no 'vector')"; return 1; }
  echo "vector available"
}

# 2a. The host files behind the mounts exist and the model files match their pinned SHA-256.
staging_check_hybrid_assets() { # [model-dir] [ort-dir] [tokenizer-sha] [model-sha]
  local mdir=${1:-$STAGING_MODEL_HOST_DIR} odir=${2:-$STAGING_ORT_HOST_DIR} tsha=${3:-$STAGING_TOKENIZER_SHA256} wsha=${4:-$STAGING_MODEL_SHA256}
  [[ -f "$mdir/tokenizer.json" ]] || { echo "missing $mdir/tokenizer.json"; return 1; }
  [[ -f "$mdir/onnx/model_quantized.onnx" ]] || { echo "missing $mdir/onnx/model_quantized.onnx"; return 1; }
  [[ -f "$odir/node_modules/onnxruntime-web/package.json" ]] || { echo "missing $odir/node_modules/onnxruntime-web (the ONNX runtime)"; return 1; }
  [[ "$(_sha256 "$mdir/tokenizer.json")" == "$tsha" ]] || { echo "$mdir/tokenizer.json does not match the pinned SHA-256"; return 1; }
  [[ "$(_sha256 "$mdir/onnx/model_quantized.onnx")" == "$wsha" ]] || { echo "$mdir/onnx/model_quantized.onnx does not match the pinned SHA-256"; return 1; }
  echo "model files match the pinned SHA-256; runtime present"
}

# 2b. After the rollout: both model mounts are present on the running backend and read-only.
staging_check_backend_mounts() {
  local mounts; mounts=$(docker inspect -f '{{range .Mounts}}{{.Destination}} {{if .RW}}rw{{else}}ro{{end}}{{println}}{{end}}' "$STAGING_BACKEND_CONTAINER" 2>/dev/null) || { echo "cannot read the backend container"; return 1; }
  local target
  for target in "$STAGING_MODEL_MOUNT_TARGET" "$STAGING_ORT_MOUNT_TARGET"; do
    grep -qx "$target ro" <<<"$mounts" || { echo "the backend does not have $target mounted read-only"; return 1; }
  done
  echo "both model mounts present and read-only"
}
