#!/bin/sh
# After the resources exist: the storage account serves the site as a static website, and the season's attacks go into
# AI Search so the closest earlier attempt searches the whole season. Signs in as the developer (azd's own sign-in).
set -eu
az storage blob service-properties update --auth-mode login \
  --account-name "$TEMPO_STORAGE_ACCOUNT" --static-website --index-document index.html --404-document index.html
eval "$(azd env get-values)"
export TEMPO_AZURE_SEARCH_ENDPOINT
uv sync --extra azure
uv run tempo index
