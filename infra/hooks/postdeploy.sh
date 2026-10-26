#!/bin/sh
# After the services' image is deployed: the site is built and published to the static website, with the demo run
# beside it under runs/. A live match's run is written there by the live service at full time (tempo/azure/blob.py).
set -eu
eval "$(azd env get-values)"
bun install --frozen-lockfile
bun run build
az storage blob upload-batch --auth-mode login --overwrite \
  --account-name "$TEMPO_STORAGE_ACCOUNT" --destination '$web' --source dist
echo "site: $TEMPO_SITE_URL"
echo "a live screen: ${TEMPO_SITE_URL}match/?live=$TEMPO_LIVE_URL"
