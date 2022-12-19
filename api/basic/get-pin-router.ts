import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { Response } from './schema.js'

import { doAuth } from './helper/auth-basic.js'
import { fetchGetPin } from './helper/fetchers.js'
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
    LEGACY_CLUSTER_IPFS_URL: legacyClusterIpfsEndpoint = '',
    PICKUP_ENDPOINT: pickupEndpoint = ''
  } = process.env

  const authError = doAuth(event.headers.authorization)
  if (authError != null) return authError

  const cid = event.pathParameters?.cid ?? ''

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const validationError: Response | undefined =
    validateRoutingConfiguration({
      legacyClusterIpfsEndpoint,
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

    const legacyClusterIpfsResponse = await fetchGetPin({ cid, endpoint: legacyClusterIpfsEndpoint, token })

    return { ...legacyClusterIpfsResponse, body: JSON.stringify(legacyClusterIpfsResponse.body) }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}
