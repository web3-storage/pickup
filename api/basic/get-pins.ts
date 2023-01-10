import { DynamoDBClient, ReturnConsumedCapacity } from '@aws-sdk/client-dynamodb'
import { BatchGetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { Pin, Response } from './schema.js'
import { doAuth } from './helper/auth-basic.js'
import { logger, withLambdaRequest } from './helper/logger.js'
import { toGetPinResponse } from './helper/to-get-pin-response.js'
import {
  validateDynamoDBConfiguration,
  validateGetPinsParameters
} from './helper/validators.js'

interface GetPinInput {
  cids: string[]
  dynamo: DynamoDBClient
  table: string
  batchItemCount: number
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
    LOG_LEVEL: logLevel = 'info',
    BATCH_ITEM_COUNT: batchItemCount = 50
  } = process.env

  logger.level = logLevel
  withLambdaRequest(event, context)

  logger.info('Get pins request')

  const authError = doAuth(event.headers.authorization)
  if (authError != null) return authError

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const validationError: Response | undefined =
    validateDynamoDBConfiguration({ table }) ||
    validateGetPinsParameters({ cids: event.queryStringParameters?.cids || '' })

  if (validationError != null) {
    return validationError
  }

  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing
  const cids = (event.queryStringParameters?.cids || '').split(',')

  if (cids.length === 0) {
    return { statusCode: 200, body: '' }
  }

  try {
    const pins = await getPins({ cids, dynamo, table, batchItemCount: Number(batchItemCount) })

    return {
      statusCode: 200,
      body: cids.map(
        cid => JSON.stringify(toGetPinResponse(cid, pins[cid], ipfsAddr, ipfsPeerId))).join('\n')
    }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}

export const getPins = async ({ cids, dynamo, table, batchItemCount }: GetPinInput): Promise<Record<string, Pin>> => {
  const client = DynamoDBDocumentClient.from(dynamo)

  const chunkSize = batchItemCount
  const chunks: string[][] = []

  for (let i = 0; i < cids.length; i += chunkSize) {
    const chunk = cids.slice(i, i + chunkSize)
    chunks.push(chunk)
  }

  const response: Pin[] = []
  for (const chunk of chunks) {
    const data = await client.send(new BatchGetCommand({
      RequestItems: {
        [table]: {
          Keys: chunk.map(cid => ({ cid }))
        }
      },
      ReturnConsumedCapacity: ReturnConsumedCapacity.TOTAL
    }))

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    data?.Responses?.[table].forEach((item, index) => item ? response.push(item as unknown as Pin) : { cid: chunk[index] })
  }

  return response.reduce((acc: Record<string, Pin>, next) => {
    acc[next.cid] = next
    return acc
  }, {})
}
