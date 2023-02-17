import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2, Context } from 'aws-lambda'

import { PeerMapValue, Pin, Response, ResponseBody, ValidationError } from './schema.js'
import { doAuth, getValidCredentials } from './helper/auth-basic.js'
import usePickup from './helper/use-pickup.js'
import { logger, setLoggerWithLambdaRequest } from './helper/logger.js'
import { fetchAddPin, fetchGetPin } from './helper/fetchers.js'
import {
  validateDynamoDBConfiguration,
  validateRoutingConfiguration,
  validateEventParameters
} from './helper/validators.js'
import { sanitizeCid } from './helper/cid.js'
import { toAddPinResponse, toResponse, toResponseError } from './helper/response.js'

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
export async function handler (event: APIGatewayProxyEventV2, context: Context): Promise<Response> {
  const {
    TABLE_NAME: table = '',
    CLUSTER_BASIC_AUTH_TOKEN: token = getValidCredentials(),
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined,
    LEGACY_CLUSTER_IPFS_URL: legacyClusterIpfsUrl = '',
    PICKUP_URL: pickupUrl = '',
    BALANCER_RATE: balancerRate = 100,
    LOG_LEVEL: logLevel = 'info'
  } = process.env

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const cid = event.pathParameters?.cid ? sanitizeCid(event.pathParameters.cid) : ''
  const origins = event.queryStringParameters?.origins?.split(',') ?? []

  logger.level = logLevel
  context.functionName = 'ADD_PIN_ROUTER_LAMBDA'
  setLoggerWithLambdaRequest(event, context)

  logger.info({ code: 'INVOKE' }, 'Add pin router invokation')

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  if (!doAuth(event.headers.authorization)) {
    logger.error({ code: 'INVALID_AUTH', event }, 'User not authorized on add pin router')
    return toResponseError(401, 'UNAUTHORIZED')
  }

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  let validationError: ValidationError | undefined =
    validateDynamoDBConfiguration({ table }) ||
    validateRoutingConfiguration({ legacyClusterIpfsUrl, pickupUrl })

  if (validationError != null) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation config error on add pin router')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR')
  }

  validationError = validateEventParameters({ cid })

  if (validationError) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation event params error on add pin router')
    return toResponseError(400, 'BAD_REQUEST', validationError.message)
  }

  try {
    const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
    const res = await addPin({
      cid, origins, dynamo, table, legacyClusterIpfsUrl, pickupUrl, token, balancerRate: Number(balancerRate)
    })
    return toResponse(res)
  } catch (err: any) {
    logger.error({ err, code: err.code }, 'Error on add pin router')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR', err.message)
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
}: AddPinInput): Promise<ResponseBody> {
  const pinFromDynamo = await getPinFromDynamo(dynamo, table, cid)

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (pinFromDynamo) {
    logger.info({ code: 'FROM_DYNAMO' }, 'CID exists on dynamo')
    if (pinFromDynamo.status === 'failed') { 
      // try to fetch a previously failed pin if the user asks it to be pinned again.
      logger.info({ code: 'FROM_PICKUP' }, 'Call POST addPin on pickup')
      return await fetchAddPin({ origins, cid, endpoint: pickupUrl, token, isInternal: true })
    }
    return toAddPinResponse(pinFromDynamo, origins)
  }

  // Verify if the CID exists in the legacy ipfs cluster
  logger.debug('Load CID entry from legacy cluster')
  const legacyClusterIpfsResponse = await fetchGetPin({ cid, endpoint: legacyClusterIpfsUrl, token })

  const notUnpinnedPeerMaps = legacyClusterIpfsResponse && Object.values(legacyClusterIpfsResponse.peer_map).filter(pin => pin.status !== 'unpinned')
  if (notUnpinnedPeerMaps && notUnpinnedPeerMaps.length > 0) {
    logger.info({ code: 'FROM_LEGACY_CLUSTER' }, 'CID exists on legacy cluster')
    const peerMap =
      ((notUnpinnedPeerMaps.find(pin => pin.status === 'pinned') != null) ||
        notUnpinnedPeerMaps.find(pin => pin.status !== 'unpinned')) as PeerMapValue

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return toAddPinResponse({ cid, created: peerMap.timestamp } as Pin, origins)
  }

  logger.debug({ balancerRate }, 'CID not exists, route the request using the balancer')
  // The CID is not pinned anywere, run the balance function and return based on the result
  if (usePickup(balancerRate)) {
    logger.info({ code: 'FROM_PICKUP' }, 'Call POST addPin on pickup')
    return await fetchAddPin({ origins, cid, endpoint: pickupUrl, token, isInternal: true })
  }

  logger.info({ code: 'FROM_LEGACY' }, 'Call POST addPin on legacy cluster')
  return await fetchAddPin({ origins, cid, endpoint: legacyClusterIpfsUrl, token })
}

async function getPinFromDynamo (dynamo: DynamoDBClient, table: string, cid: string): Promise<Pin | undefined> {
  const client = DynamoDBDocumentClient.from(dynamo)
  const existing = await client.send(new GetCommand({
    TableName: table,
    Key: { cid }
  }))

  return (existing.Item != null) ? (existing.Item as Pin) : undefined
}
