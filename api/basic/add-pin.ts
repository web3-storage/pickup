import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { ClusterAddResponseBody, ErrorCode, Pin, Response, ValidationError } from './schema.js'
import { nanoid } from 'nanoid'
import { doAuth } from './helper/auth-basic.js'
import {
  validateDynamoDBConfiguration,
  validateEventParameters, validateS3Configuration, validateSQSConfiguration
} from './helper/validators.js'
import { sanitizeCid } from './helper/cid.js'
import { logger, setLoggerWithLambdaRequest } from './helper/logger.js'
import { toAddPinResponse, toResponse, toResponseError } from './helper/response.js'

interface UpsertPinInput {
  cid: string
  dynamo: DynamoDBClient
  table: string
}

interface AddToQueueInput {
  cid: string
  origins: string[]
  bucket: string
  sqs: SQSClient
  queueUrl: string
}

// type AddPinInput = AddToQueueInput & UpsertPinInput
interface AddPinInput extends UpsertPinInput, AddToQueueInput {}

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
    BUCKET_NAME: bucket = '',
    QUEUE_URL: queueUrl = '',
    // set for testing
    SQS_ENDPOINT: sqsEndpoint = undefined,
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined,
    LOG_LEVEL: logLevel = 'info'
  } = process.env

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const cid = event.pathParameters?.cid ? sanitizeCid(event.pathParameters.cid) : ''
  const origins = event.queryStringParameters?.origins?.split(',') ?? []

  logger.level = logLevel
  context.functionName = 'ADD_PIN_LAMBDA'
  setLoggerWithLambdaRequest(event, context)

  logger.info({ code: 'INVOKE' }, 'Add pin invokation')

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  if (!doAuth(event.headers.authorization)) {
    logger.error({ code: 'INVALID_AUTH', event }, 'User not authorized on add pin')
    return toResponseError(401, 'UNAUTHORIZED')
  }

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  let validationError: ValidationError | undefined =
    validateS3Configuration({ bucket }) ||
    validateSQSConfiguration({ queueUrl }) ||
    validateDynamoDBConfiguration({ table })

  if (validationError != null) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation config error on add pin')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR')
  }

  validationError = validateEventParameters({ cid, origins })

  if (validationError) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation event params error on add pin')
    return toResponseError(400, 'BAD_REQUEST', validationError.message)
  }

  try {
    const sqs = new SQSClient({ endpoint: sqsEndpoint })
    const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
    const res = await addPin({ cid, origins, bucket, sqs, queueUrl, dynamo, table })
    return toResponse(res)
  } catch (err: any) {
    logger.error({ err, code: err.code }, 'Error on add pin')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR', err.message)
  }
}

/**
 * Handle a request to pin a CID.
 * Returns existing Pin info if we have it, otherwise inserts a Pin record to
 * DynamoDB and adds a message to SQS to kick off a pickup of the requested CID
 * with optional source multiaddrs specified as origins list.
 */
export async function addPin ({ cid, origins, bucket, sqs, queueUrl, dynamo, table }: AddPinInput): Promise<ClusterAddResponseBody> {
  const { shouldQueue, pin } = await putIfNotExists({ cid, dynamo, table })
  if (shouldQueue) {
    await addToQueue({ cid, origins, bucket, sqs, queueUrl })
  }
  return toAddPinResponse(pin, origins)
}

/**
 * Save Pin to Dynamo. If we already have that CID then return the existing.
 */
export async function putIfNotExists ({ cid, dynamo, table }: UpsertPinInput): Promise<{shouldQueue: boolean, pin: Pin}> {
  const client = DynamoDBDocumentClient.from(dynamo)
  const pin: Pin = {
    cid,
    status: 'queued',
    created: new Date().toISOString()
  }
  try {
    // TODO should be read then write, since reads are faster
    await client.send(new PutCommand({
      TableName: table,
      Item: pin,
      ConditionExpression: 'attribute_not_exists(cid)'
    }))
    logger.info({ code: 'DYNAMO_PUT' }, 'New pin saved')
    // Pin was saved, so return it
    return { shouldQueue: true, pin }
  } catch (err) {
    // expected error if CID already exists
    // TODO handle failure for "get" command
    if (err instanceof ConditionalCheckFailedException) {
      const existing = await client.send(new GetCommand({
        TableName: table,
        Key: { cid }
      }))
      logger.info({ code: 'DYNAMO_GET' }, 'Get existing pin')

      const foundPin = existing.Item as Pin
      let newPin
      if (foundPin.status === 'failed') {
        newPin = await updateFailedItem({ cid, dynamo, table })
        return { shouldQueue: true, pin: newPin }
      }

      return { shouldQueue: false, pin: existing.Item as Pin }
    }
    logger.error({ err }, 'Dynamo error')
  }
  throw new ErrorCode('DYNAMO_SAVE_PIN', 'Failed to save Pin. Please try again')
}

/**
 * Save Pin to Dynamo. If we already have that CID then return the existing.
 */
export async function updateFailedItem ({ cid, dynamo, table }: UpsertPinInput): Promise<Pin> {
  const pin: Pin = {
    cid,
    status: 'queued',
    created: new Date().toISOString()
  }
  try {
    const client = DynamoDBDocumentClient.from(dynamo)
    await client.send(new UpdateCommand({
      TableName: table,
      Key: { cid },
      ExpressionAttributeNames: {
        '#status': 'status',
        '#created': 'created'
      },
      ExpressionAttributeValues: {
        ':s': 'queued',
        ':c': pin.created,
        ':expectedStatus': 'failed'
      },
      UpdateExpression: 'set #status = :s, #created = :c',
      ConditionExpression: '#status = :expectedStatus',
      ReturnValues: 'ALL_NEW'
    }))

    return pin
  } catch (err) {
    logger.error({ err }, 'Dynamo update failed status')
    throw err
  }
}

/**
 * Send message to SQS for pickup to fetch that CID
 */
async function addToQueue ({ cid, origins, sqs, queueUrl, bucket }: AddToQueueInput): Promise<void> {
  try {
    const requestid = `${Date.now()}-${nanoid(13)}`
    const message = {
      requestid,
      cid,
      origins,
      bucket,
      key: `pickup/${cid}/${cid}.root.car`
    }
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }))
    return
  } catch (err) {
    logger.error({ err }, 'SQS error')
  }
  throw new ErrorCode('SQS_SEND', 'Failed to save Pin. Please try again')
}
