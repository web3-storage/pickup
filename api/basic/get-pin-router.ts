import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ClusterStatusResponse, Response } from './schema.js'

import fetch from 'node-fetch'

import { doAuth } from './helper/auth-basic.js'
import {
  validateEventParameters,
  validateRoutingConfiguration
} from './helper/validators.js'

/**
 * AWS API Gateway handler for GET /pins/${cid}
 * Collect the params and delegate to getPin to do the work
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 */
export async function handler (event: APIGatewayProxyEventV2): Promise<Response> {
  const {
    CLUSTER_BASIC_AUTH_TOKEN: token = '',
    INDEXER_ENDPOINT: indexerEndpoint = '',
    PICKUP_ENDPOINT: pickupEndpoint = ''
  } = process.env

  const authError = doAuth(event.headers.authorization)
  if (authError != null) return authError

  const cid = event.pathParameters?.cid ?? ''

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const validationError: Response | undefined =
    validateRoutingConfiguration({
      indexerEndpoint,
      pickupEndpoint
    }) ||
    validateEventParameters({ cid })

  if (validationError != null) {
    return { statusCode: validationError.statusCode, body: JSON.stringify(validationError.body) }
  }

  try {
    const pickupResponse = await fetchGetPin({ cid, endpoint: pickupEndpoint, isInternal: true, token })

    if (pickupResponse.statusCode === 200 && (Object.values(pickupResponse.body?.peer_map).filter(pin => pin.status !== 'unpinned').length > 0)) {
      return { ...pickupResponse, body: JSON.stringify(pickupResponse.body) }
    }

    const indexerResponse = await fetchGetPin({ cid, endpoint: indexerEndpoint, token })

    return { ...indexerResponse, body: JSON.stringify(indexerResponse.body) }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}

// Load balancing extensions
interface GetPinResult {
  statusCode: number
  body: ClusterStatusResponse
}

interface FetchGetPinParams {
  cid: string
  endpoint: string
  token: string
  isInternal?: boolean
}

async function fetchGetPin ({
  cid,
  endpoint,
  token,
  isInternal = false
}: FetchGetPinParams): Promise<GetPinResult> {
  const baseUrl = (new URL(endpoint))
  const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins/${cid}`, baseUrl.origin)
  const result = await fetch(myURL.href, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

  return { statusCode: result.status, body: (await result.json()) as ClusterStatusResponse }
}
