// Tempo on Azure: `azd up` provisions this and deploys the services' image. Everything is in one resource group, and
// every service signs in as one user-assigned managed identity that holds a data-plane role on each resource it uses,
// so no key or connection secret exists anywhere. resources.bicep has the resources; this file makes the group.
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('The azd environment name; it names the resource group and seeds every resource name.')
param environmentName string

@minLength(1)
@description('One region that has every service used: Container Apps, Event Hubs, Cosmos DB, Web PubSub, AI Search, AI Services with the writer model and Speech.')
param location string

@description('The services image, set by azd deploy.')
param serviceImage string = ''

@description('The model the writer deployment serves, and its version.')
param writerModel string = 'gpt-4.1-mini'
param writerModelVersion string = '2025-04-14'

@description('The signed-in developer, given the same data roles so the CLI works against the same resources.')
param principalId string = ''

var tags = { 'azd-env-name': environmentName, app: 'tempo' }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'tempo'
  scope: rg
  params: {
    location: location
    tags: tags
    token: toLower(uniqueString(subscription().id, environmentName, location))
    serviceImage: serviceImage
    writerModel: writerModel
    writerModelVersion: writerModelVersion
    principalId: principalId
  }
}

// what azd writes to the environment, and so what `tempo` reads on a developer's machine (tempo/azure/settings.py)
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.registry
output AZURE_CLIENT_ID string = resources.outputs.identityClientId
output TEMPO_AZURE_SPEECH_ENDPOINT string = resources.outputs.speechEndpoint
output TEMPO_AZURE_EVENTHUBS_NAMESPACE string = resources.outputs.eventHubsNamespace
output TEMPO_AZURE_COSMOS_ENDPOINT string = resources.outputs.cosmosEndpoint
output TEMPO_AZURE_WEBPUBSUB_ENDPOINT string = resources.outputs.webPubSubEndpoint
output TEMPO_AZURE_SEARCH_ENDPOINT string = resources.outputs.searchEndpoint
output TEMPO_AZURE_FOUNDRY_ENDPOINT string = resources.outputs.foundryEndpoint
output TEMPO_AZURE_BLOB_ENDPOINT string = resources.outputs.blobEndpoint
output APPLICATIONINSIGHTS_CONNECTION_STRING string = resources.outputs.appInsightsConnection
output TEMPO_SITE_URL string = resources.outputs.siteUrl
output TEMPO_LIVE_URL string = resources.outputs.liveUrl
output TEMPO_STORAGE_ACCOUNT string = resources.outputs.storageAccount
