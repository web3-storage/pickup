import querystring from 'node:querystring'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import fetch from 'node-fetch'

import { ClusterAddResponse, ClusterStatusResponse, PeerMapValue, Pin, Response } from './schema.js'
import { doAuth } from './helper/auth-basic.js'
import usePickup from './helper/use-pickup.js'
import {
  validateDynamoDBConfiguration,
  validateRoutingConfiguration,
  validateEventParameters
} from './helper/validators.js'

interface AddPinInput {
  cid: string
  origins: string[]
  dynamo: DynamoDBClient
  table: string
  indexerEndpoint: string
  pickupEndpoint: string
  token: string
  balancerRate: number
}

/**
 * AWS API Gateway handler for POST /pin/${cid}?&origins=${multiaddr},${multiaddr}
 * Collect the params and delegate to addPin to do the work
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 */
export async function handler (event: APIGatewayProxyEventV2): Promise<Response> {
  const {
    TABLE_NAME: table = '',
    CLUSTER_BASIC_AUTH_TOKEN: token = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined,
    INDEXER_ENDPOINT: indexerEndpoint = '',
    PICKUP_ENDPOINT: pickupEndpoint = '',
    BALANCER_RATE: balancerRate = 100
  } = process.env

  const authError = doAuth(event.headers.authorization)
  if (authError != null) return authError

  const cid = event.pathParameters?.cid ?? ''
  const origins = event.queryStringParameters?.origins?.split(',') ?? []

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const validationError: Response | undefined =
    validateDynamoDBConfiguration({ table }) ||
    validateRoutingConfiguration({
      indexerEndpoint,
      pickupEndpoint
    }) ||
    validateEventParameters({ cid, origins })

  if (validationError != null) {
    return { statusCode: validationError.statusCode, body: JSON.stringify(validationError.body) }
  }

  try {
    const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
    const res = await addPin({
      cid, origins, dynamo, table, indexerEndpoint, pickupEndpoint, token, balancerRate: Number(balancerRate)
    })
    return { ...res, body: JSON.stringify(res.body) }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}

/**
 * Handle a request to pin a CID.
 * Returns existing Pin info if we have it, otherwise inserts a Pin record to
 * DynamoDB and adds a message to SQS to kick off a pickup of the requested CID
 * with optional source multiaddrs specified as origins list.
 */
export async function addPin ({
  cid,
  origins,
  dynamo,
  table,
  indexerEndpoint,
  pickupEndpoint,
  token,
  balancerRate
}: AddPinInput): Promise<Response> {
  const pinFromDynamo = await getPinFromDynamo(dynamo, table, cid)

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (pinFromDynamo) {
    return { statusCode: 200, body: toClusterResponse(pinFromDynamo, origins) }
  }

  // Verify if the CID exists in the indexer
  const indexerResultJSON = await fetchGetPin({ cid, endpoint: indexerEndpoint, token })

  const notUnpinnedPeerMaps = Object.values(indexerResultJSON.body?.peer_map).filter(pin => pin.status !== 'unpinned')
  if (notUnpinnedPeerMaps.length > 0) {
    const peerMap = ((notUnpinnedPeerMaps.find(pin => pin.status === 'pinned') != null) || notUnpinnedPeerMaps.find(pin => pin.status !== 'unpinned')) as PeerMapValue
    return {
      statusCode: 200,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      body: toClusterResponse({ cid, created: peerMap.timestamp } as Pin, origins)
    }
  }

  // The CID is not pinned anywere, run the balance function and return based on the result
  if (usePickup(balancerRate)) {
    return await fetchAddPin({ origins, cid, endpoint: pickupEndpoint, token, isInternal: true })
  }

  return await fetchAddPin({ origins, cid, endpoint: indexerEndpoint, token })
}

export function toClusterResponse (pin: Pin, origins: string[]): ClusterAddResponse {
  return {
    replication_factor_min: -1,
    replication_factor_max: -1,
    name: '',
    mode: 'recursive',
    shard_size: 0,
    user_allocations: null,
    expire_at: '0001-01-01T00:00:00Z',
    metadata: {},
    pin_update: null,
    origins: origins,
    cid: pin.cid,
    type: 'pin',
    allocations: [],
    max_depth: -1,
    reference: null,
    timestamp: pin.created
  }
}

async function getPinFromDynamo (dynamo: DynamoDBClient, table: string, cid: string): Promise<Pin | undefined> {
  const client = DynamoDBDocumentClient.from(dynamo)
  const existing = await client.send(new GetCommand({
    TableName: table,
    Key: { cid }
  }))

  return (existing.Item != null) ? (existing.Item as Pin) : undefined
}

// Load balancing extensions

interface AddPinResult {
  statusCode: number
  body: ClusterAddResponse
}

interface GetPinResult {
  statusCode: number
  body: ClusterStatusResponse
}

interface FetchAddPinParams {
  cid: string
  endpoint: string
  token: string
  origins: string[]
  isInternal?: boolean
}

interface FetchGetPinParams {
  cid: string
  endpoint: string
  token: string
}

async function fetchAddPin ({
  cid,
  endpoint,
  token,
  origins,
  isInternal = false
}: FetchAddPinParams): Promise<AddPinResult> {
  const baseUrl = (new URL(endpoint))
  const query = (origins.length > 0) ? `?${querystring.stringify({ origins: origins.join(',') })}` : ''
  const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins/${cid}${query}`, baseUrl.origin)
  const result = await fetch(myURL.href, { method: 'POST', headers: { Authorization: `Basic ${token}` } })

  return { statusCode: result.status, body: (await result.json()) as ClusterAddResponse }
}

async function fetchGetPin ({
  cid,
  endpoint,
  token
}: FetchGetPinParams): Promise<GetPinResult> {
  const baseUrl = (new URL(endpoint))
  const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}/pins/${cid}`, baseUrl.origin)
  const result = await fetch(myURL.href, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

  return { statusCode: result.status, body: (await result.json()) as ClusterStatusResponse }
}
