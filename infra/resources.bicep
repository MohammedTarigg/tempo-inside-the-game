// Every resource Tempo runs on, in one resource group (main.bicep makes the group).
//
//   Event Hubs        the feed, the commentary and the cues, a hub each, one partition per match (tempo/azure/eventhubs.py)
//   Cosmos DB         the ledger: facts, cues, checkpoints and the audit, partitioned by match (cosmos.py)
//   AI Services       Speech for the commentary (speech.py), and the writer model deployment (foundry.py)
//   AI Search         the season's attacks, for the closest earlier attempt (search.py)
//   Web PubSub        the cues to the screens (webpubsub.py)
//   Storage           the site and each run's files, served as a static website (blob.py)
//   Container Apps    the live service; the feeder and the listener as jobs started by hand
//   App Insights      spans and the audit (telemetry.py)
//
// One user-assigned identity signs in for all of them. Local keys are turned off on every resource that has them.

param location string
param tags object
param token string
param serviceImage string
param writerModel string
param writerModelVersion string
param principalId string

var image = empty(serviceImage) ? 'mcr.microsoft.com/k8se/quickstart:latest' : serviceImage
var topics = ['feed', 'commentary', 'cues']
var ledgerContainers = ['facts', 'cues', 'checkpoints', 'audit']
// the data-plane roles the services need, granted on this group and nothing wider
var roles = {
  eventHubsDataOwner: 'f526a384-b230-433a-b45c-95f59c4a2dec'
  webPubSubServiceOwner: '12cf5a90-567b-43ae-8102-96cf46c7d9b4'
  searchIndexDataContributor: '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
  searchServiceContributor: '7ca78c08-252a-4471-8644-bb5ff32d4ba0'
  cognitiveServicesUser: 'a97b65f3-24c7-4388-baec-2e87135dc908'
  cognitiveServicesOpenAIUser: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

// ----- identity -----
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-tempo-${token}'
  location: location
  tags: tags
}

resource dataRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for role in items(roles): {
    name: guid(resourceGroup().id, identity.id, role.value)
    properties: {
      principalId: identity.properties.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role.value)
    }
  }
]

resource developerRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for role in items(roles): if (!empty(principalId)) {
    name: guid(resourceGroup().id, principalId, role.value)
    properties: {
      principalId: principalId
      principalType: 'User'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role.value)
    }
  }
]

// ----- monitoring -----
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-tempo-${token}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-tempo-${token}'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

// ----- Event Hubs: the bus -----
resource eventHubs 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: 'evhns-tempo-${token}'
  location: location
  tags: tags
  sku: { name: 'Standard', tier: 'Standard', capacity: 1 }
  properties: { disableLocalAuth: true, minimumTlsVersion: '1.2' }
}

resource hubs 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = [
  for topic in topics: {
    parent: eventHubs
    name: topic
    properties: { partitionCount: 4, messageRetentionInDays: 1 }
  }
]

// ----- Cosmos DB: the ledger -----
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'cosmos-tempo-${token}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0 }]
  }
}

resource ledger 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: 'tempo'
  properties: { resource: { id: 'tempo' } }
}

resource ledgerParts 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [
  for name in ledgerContainers: {
    parent: ledger
    name: name
    properties: {
      resource: {
        id: name
        partitionKey: { paths: ['/match_id'], kind: 'Hash' }
      }
    }
  }
]

// Cosmos DB's data plane has its own roles: the built-in data contributor, for the services and the developer
resource cosmosData 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, identity.id, 'data-contributor')
  properties: {
    principalId: identity.properties.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmos.id
  }
}

resource cosmosDeveloper 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = if (!empty(principalId)) {
  parent: cosmos
  name: guid(cosmos.id, principalId, 'data-contributor')
  properties: {
    principalId: principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmos.id
  }
}

// ----- AI Services: Speech and the writer model -----
resource ai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'ais-tempo-${token}'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: 'ais-tempo-${token}' // Entra ID sign-in needs the resource's own address
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource writer 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: ai
  name: 'writer'
  sku: { name: 'GlobalStandard', capacity: 50 }
  properties: { model: { format: 'OpenAI', name: writerModel, version: writerModelVersion } }
}

// ----- AI Search: the season's attacks -----
resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: 'srch-tempo-${token}'
  location: location
  tags: tags
  sku: { name: 'basic' }
  properties: { replicaCount: 1, partitionCount: 1, disableLocalAuth: true }
}

// ----- Web PubSub: the screens -----
resource pubsub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: 'wps-tempo-${token}'
  location: location
  tags: tags
  sku: { name: 'Standard_S1', capacity: 1 }
  properties: { disableLocalAuth: true }
}

resource pubsubHub 'Microsoft.SignalRService/webPubSub/hubs@2024-03-01' = {
  parent: pubsub
  name: 'tempo'
  properties: { anonymousConnectPolicy: 'deny' } // a screen needs a token from the live service's /negotiate
}

// ----- Storage: the site and the runs -----
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'sttempo${take(token, 16)}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false // the static website is served from its own endpoint; nothing else is public
    minimumTlsVersion: 'TLS1_2'
  }
}

// ----- Container Apps -----
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crtempo${token}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'acrpull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource apps 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-tempo-${token}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

var site = replace(replace(storage.properties.primaryEndpoints.web, 'https://', ''), '/', '')
// what every container is told: where each resource is, and which identity to sign in as (tempo/azure/settings.py)
var env = [
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'TEMPO_AZURE_SPEECH_ENDPOINT', value: 'https://${ai.properties.customSubDomainName}.cognitiveservices.azure.com' }
  { name: 'TEMPO_AZURE_EVENTHUBS_NAMESPACE', value: '${eventHubs.name}.servicebus.windows.net' }
  { name: 'TEMPO_AZURE_COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
  { name: 'TEMPO_AZURE_WEBPUBSUB_ENDPOINT', value: 'https://${pubsub.properties.hostName}' }
  { name: 'TEMPO_AZURE_SEARCH_ENDPOINT', value: 'https://${search.name}.search.windows.net' }
  { name: 'TEMPO_AZURE_FOUNDRY_ENDPOINT', value: 'https://${ai.properties.customSubDomainName}.openai.azure.com' }
  { name: 'TEMPO_AZURE_FOUNDRY_DEPLOYMENT', value: writer.name }
  { name: 'TEMPO_AZURE_BLOB_ENDPOINT', value: storage.properties.primaryEndpoints.blob }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
  { name: 'TEMPO_SITE_ORIGIN', value: 'https://${site}' }
]
var identityRef = { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
var pull = [{ server: registry.properties.loginServer, identity: identity.id }]

// the live service: one replica a match, always on while it is played; the screens reach /cues and /negotiate
resource live 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-tempo-live-${token}'
  location: location
  tags: union(tags, { 'azd-service-name': 'live' })
  identity: identityRef
  dependsOn: [acrPull, dataRoles, cosmosData]
  properties: {
    managedEnvironmentId: apps.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        corsPolicy: { allowedOrigins: ['https://${site}'], allowedMethods: ['GET'] }
      }
      registries: pull
    }
    template: {
      containers: [
        {
          name: 'live'
          image: image
          args: ['live', 'm_demo']
          env: env
          resources: { cpu: json('2.0'), memory: '4Gi' }
          probes: [
            { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 30 }
            { type: 'Startup', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10, failureThreshold: 30 }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 } // one process per match: its state is the match
    }
  }
}

// the feeder and the listener run once per match, started by hand: `az containerapp job start`
resource feederJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'caj-tempo-feed-${token}'
  location: location
  tags: tags
  identity: identityRef
  dependsOn: [acrPull, dataRoles]
  properties: {
    environmentId: apps.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 3 * 60 * 60
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: pull
    }
    template: {
      containers: [
        {
          name: 'feed'
          image: image
          args: ['feed', '--no-commentary'] // the commentary comes from the listener, through AI Speech
          env: env
          resources: { cpu: json('1.0'), memory: '2Gi' }
        }
      ]
    }
  }
}

resource listenerJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'caj-tempo-listen-${token}'
  location: location
  tags: tags
  identity: identityRef
  dependsOn: [acrPull, dataRoles]
  properties: {
    environmentId: apps.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 3 * 60 * 60
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: pull
    }
    template: {
      containers: [
        {
          name: 'listen'
          image: image
          args: ['listen', '--match', 'm_demo', '--audio', 'assets/audio/commentator.wav', '--at', '2110'] // the demo's line, said at 35:10
          env: env
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
}

output registry string = registry.properties.loginServer
output identityClientId string = identity.properties.clientId
output speechEndpoint string = 'https://${ai.properties.customSubDomainName}.cognitiveservices.azure.com'
output eventHubsNamespace string = '${eventHubs.name}.servicebus.windows.net'
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output webPubSubEndpoint string = 'https://${pubsub.properties.hostName}'
output searchEndpoint string = 'https://${search.name}.search.windows.net'
output foundryEndpoint string = 'https://${ai.properties.customSubDomainName}.openai.azure.com'
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output appInsightsConnection string = insights.properties.ConnectionString
output siteUrl string = storage.properties.primaryEndpoints.web
output liveUrl string = 'https://${live.properties.configuration.ingress.fqdn}'
output storageAccount string = storage.name
