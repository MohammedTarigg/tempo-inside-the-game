"""A finished run's files in Azure Blob Storage, where the site reads them. The site is the storage account's static
website (the `$web` container, published by infra/hooks/postdeploy.sh), and it fetches a run from /runs/<match>/. So the
run folder (web/public/runs/<match>/, see tempo/pipeline/export.py) goes up as it is, under runs/<match>/ beside the
site, each file with the content type the browser needs."""

import mimetypes
import os
from typing import Any

from .settings import AzureSettings, credential

TYPES = {".bin": "application/octet-stream", ".jsonl": "application/x-ndjson", ".json": "application/json"}


def upload_run(cfg: AzureSettings, folder: str, match_id: str, container: Any = None):
    """Uploads every file in the run folder, replacing what was there. Returns the blob names written."""
    if container is None:
        if not cfg.blob_endpoint:
            raise ValueError("TEMPO_AZURE_BLOB_ENDPOINT is not set")
        from azure.storage.blob import BlobServiceClient

        container = BlobServiceClient(cfg.blob_endpoint, credential=credential()).get_container_client(
            cfg.blob_container
        )
    from azure.storage.blob import ContentSettings

    names = []
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            continue
        kind = TYPES.get(os.path.splitext(name)[1]) or mimetypes.guess_type(name)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            container.upload_blob(
                f"runs/{match_id}/{name}",
                f,
                overwrite=True,
                content_settings=ContentSettings(content_type=kind, cache_control="no-cache"),
            )
        names.append(f"runs/{match_id}/{name}")
    return names
