import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { Pin, Response } from './schema.js'
import { doAuth } from './helper/auth-basic.js'
import { logger, withLambdaRequest } from './helper/logger.js'
import { toGetPinResponse } from './helper/to-get-pin-response.js'

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

  logger.level = logLevel
  withLambdaRequest(event, context)

  logger.info('Get pin request')

  const authError = doAuth(event.headers.authorization)
  if (authError != null) return authError

  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
  const cid = event.pathParameters?.cid ?? ''
  try {
    const pin = await getPin({ cid, dynamo, table })
    const body = toGetPinResponse(cid, pin, ipfsAddr, ipfsPeerId)
    return { statusCode: 200, body: JSON.stringify(body) }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}

export const getPin = async ({ cid, dynamo, table }: GetPinInput): Promise<Pin | undefined> => {
  const client = DynamoDBDocumentClient.from(dynamo)

  const res = await client.send(new GetCommand({
    TableName: table,
    Key: { cid }
  }))

  const pin = res.Item as Pin

  return pin
}
