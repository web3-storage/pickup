import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2 } from 'aws-lambda'

import { ClusterAddResponse, PeerMapValue, Pin, Response } from './schema.js'
import { doAuth } from './helper/auth-basic.js'
import usePickup from './helper/use-pickup.js'
import { fetchAddPin, fetchGetPin } from './helper/fetchers.js'
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
  legacyClusterIpfsUrl: string
  pickupUrl: string
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
    LEGACY_CLUSTER_IPFS_URL: legacyClusterIpfsUrl = '',
    PICKUP_URL: pickupUrl = '',
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
      legacyClusterIpfsUrl,
      pickupUrl
    }) ||
    validateEventParameters({ cid, origins })

  if (validationError != null) {
    return { statusCode: validationError.statusCode, body: JSON.stringify(validationError.body) }
  }

  try {
    const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
    const res = await addPin({
      cid, origins, dynamo, table, legacyClusterIpfsUrl, pickupUrl, token, balancerRate: Number(balancerRate)
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
  legacyClusterIpfsUrl,
  pickupUrl,
  token,
  balancerRate
}: AddPinInput): Promise<Response> {
  const pinFromDynamo = await getPinFromDynamo(dynamo, table, cid)

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (pinFromDynamo) {
    console.log('CID exists on pickup')
    return { statusCode: 200, body: toClusterResponse(pinFromDynamo, origins) }
  }

  // Verify if the CID exists in the legacy ipfs cluster
  const legacyClusterIpfsResponse = await fetchGetPin({ cid, endpoint: legacyClusterIpfsUrl, token })

  const notUnpinnedPeerMaps = Object.values(legacyClusterIpfsResponse.body?.peer_map).filter(pin => pin.status !== 'unpinned')
  if (notUnpinnedPeerMaps.length > 0) {
    console.log('CID exists on legacy cluster')
    const peerMap = ((notUnpinnedPeerMaps.find(pin => pin.status === 'pinned') != null) || notUnpinnedPeerMaps.find(pin => pin.status !== 'unpinned')) as PeerMapValue
    return {
      statusCode: 200,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      body: toClusterResponse({ cid, created: peerMap.timestamp } as Pin, origins)
    }
  }

  console.log('CID not exists')
  // The CID is not pinned anywere, run the balance function and return based on the result
  if (usePickup(balancerRate)) {
    console.log('AddPin to pickup')
    return await fetchAddPin({ origins, cid, endpoint: pickupUrl, token, isInternal: true })
  }

  console.log('AddPin to legacy cluster')
  return await fetchAddPin({ origins, cid, endpoint: legacyClusterIpfsUrl, token })
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
