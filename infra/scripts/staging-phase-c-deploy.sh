#!/usr/bin/env bash
set -euo pipefail

echo "ABORT: the legacy Phase C hot-swap is disabled because it omits versioned images and Prisma migrations." >&2
echo "Use infra/scripts/staging-release-deploy.sh only after the release and backup gates are approved." >&2
exit 2
