import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { ErrorCode, Pin, Response } from './schema.js'
import { doAuth } from './helper/auth-basic.js'
import { sanitizeCid } from './helper/cid.js'
import { logger, setLoggerWithLambdaRequest } from './helper/logger.js'
import { toGetPinResponse, toResponse, toResponseError } from './helper/response.js'
import { validateEventParameters } from './helper/validators.js'

interface GetPinInput {
  cid: string
  dynamo: DynamoDBClient
  table: string
}

/**
 * AWS API Gateway handler for GET /pins/${cid}
 * Collect the params and delegate to getPin to do the work
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 */
export async function handler (event: APIGatewayProxyEventV2, context: Context): Promise<Response> {
  const {
    TABLE_NAME: table = '',
    CLUSTER_IPFS_ADDR: ipfsAddr = undefined,
    CLUSTER_IPFS_PEERID: ipfsPeerId = undefined,
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined,
    LOG_LEVEL: logLevel = 'info'
  } = process.env

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const cid = event.pathParameters?.cid ? sanitizeCid(event.pathParameters.cid) : ''
  logger.level = logLevel
  context.functionName = 'GET_PIN_LAMBDA'
  setLoggerWithLambdaRequest(event, context)

  logger.info({ code: 'INVOKE' }, 'Get pin invokation')

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  if (!doAuth(event.headers.authorization)) {
    logger.error({ code: 'INVALID_AUTH', event }, 'User not authorized on get pin')
    return toResponseError(401, 'UNAUTHORIZED')
  }

  // TODO validate here CLUSTER_IPFS_ADDR and CLUSTER_IPFS_PEERID

  const validationError = validateEventParameters({ cid })

  if (validationError != null) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation event params error on get pin')
    return toResponseError(400, 'BAD_REQUEST', validationError.message)
  }

  try {
    const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
    const pin = await getPin({ cid, dynamo, table })
    const res = toGetPinResponse(cid, pin, ipfsAddr, ipfsPeerId)
    return toResponse(res)
  } catch (err: any) {
    logger.error({ err, code: err.code }, 'Error on get pin')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR', err.message)
  }
}

export const getPin = async ({ cid, dynamo, table }: GetPinInput): Promise<Pin | undefined> => {
  try {
    const client = DynamoDBDocumentClient.from(dynamo)

    const res = await client.send(new GetCommand({
      TableName: table,
      Key: { cid }
    }))

    const pin = res.Item as Pin

    return pin
  } catch (err) {
    logger.error({ err }, 'Dynamo error')
  }
  throw new ErrorCode('DYNAMO_GET_PIN', 'Failed to get Pin. Please try again')
}
