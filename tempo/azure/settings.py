"""Which Azure resources a run talks to. Every setting comes from the environment, the way Container Apps hands them to
a container and `azd env` writes them locally. Nothing here is a secret: identity is Entra ID, through the container's
managed identity on Azure and the developer's own sign-in (`az login`) on a laptop. A setting that is not there leaves
its part on the local stand-in, so a run with no TEMPO_AZURE_* variables is the plain local run."""

import os
from dataclasses import dataclass, fields
from functools import cache


@dataclass(frozen=True)
class AzureSettings:
    # AI Speech: the resource's endpoint (https://<name>.cognitiveservices.azure.com) and the language it listens for
    speech_endpoint: str | None = None
    speech_language: str = "en-GB"
    # Event Hubs: the namespace's host (<name>.servicebus.windows.net). Each bus topic is an event hub of the same name
    eventhubs_namespace: str | None = None
    # Cosmos DB: the account's endpoint and the database that holds the ledger's four containers
    cosmos_endpoint: str | None = None
    cosmos_database: str = "tempo"
    # Web PubSub: the service's endpoint and the hub the screens connect to
    webpubsub_endpoint: str | None = None
    webpubsub_hub: str = "tempo"
    # AI Search: the service's endpoint and the index of attacks across the season
    search_endpoint: str | None = None
    search_index: str = "attacks"
    # Foundry: the AI Services resource's model endpoint (https://<name>.openai.azure.com) and the deployment that writes
    foundry_endpoint: str | None = None
    foundry_deployment: str = "writer"
    # Blob Storage: the account's endpoint and the container the site is served from, its static website
    blob_endpoint: str | None = None
    blob_container: str = "$web"
    # Application Insights: its connection string (an ingestion address and key, not a secret that grants access)
    appinsights_connection: str | None = None

    @property
    def any(self):
        return any(
            getattr(self, f.name) for f in fields(self) if f.name.endswith(("endpoint", "namespace", "connection"))
        )


@cache
def settings() -> AzureSettings:
    """The settings, read once: TEMPO_AZURE_<FIELD> for each field, plus Application Insights' own standard variable."""
    env = {f.name: os.environ.get("TEMPO_AZURE_" + f.name.upper()) for f in fields(AzureSettings)}
    env["appinsights_connection"] = env["appinsights_connection"] or os.environ.get(
        "APPLICATIONINSIGHTS_CONNECTION_STRING"
    )
    return AzureSettings(**{k: v for k, v in env.items() if v})


@cache
def credential():
    """One Entra ID credential for every client: the managed identity in Azure, the developer's sign-in locally. Every
    resource grants this identity a data-plane role (infra/main.bicep), so no client holds a key."""
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential(managed_identity_client_id=os.environ.get("AZURE_CLIENT_ID"))
