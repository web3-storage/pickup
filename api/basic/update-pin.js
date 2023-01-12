import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { logger, setLoggerWithLambdaRequest } from './helper/logger.js'
import { toResponse, toResponseError } from './helper/response.js'
import { ErrorCode } from './schema.js'


/**
 * Deal with the horror of S3Events wrapped up as strings in SNSEvents.
 *
 * @param {import('aws-lambda').SNSEvent} snsEvent
 */
export async function snsEventHandler (snsEvent) {
  for (const record of snsEvent.Records) {
    /** @type {import('aws-lambda').S3Event} */
    const s3Event = JSON.parse(record.Sns.Message)
    await s3EventHandler(s3Event)
  }
}

/**
 * Deal with the horror of S3Events wrapped up as strings in SQSEvents.
 *
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 */
export async function sqsEventHandler (sqsEvent) {
  for (const record of sqsEvent.Records) {
    const s3Event = JSON.parse(JSON.parse(record.body).Message)
    await s3EventHandler(s3Event)
  }
}

/**
 * Set pin status to pinned when receiving an
 * S3 `object_created` event for a .car file.
 * We assume params are fine because it's triggered from S3 events
 *
 * @param {import('aws-lambda').S3Event} event
 */
export async function s3EventHandler (event) {
  const {
    TABLE_NAME: table = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined,
    LOG_LEVEL: logLevel = 'info'
  } = process.env

  logger.level = logLevel
  context.functionName = 'UPDATE_PIN_LAMBDA'
  setLoggerWithLambdaRequest(event, context)

  logger.info({ code: 'INVOKE' }, 'Update pin invokation')

  try {
    const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })

    const res = []
    for (const record of event.Records) {
      const { key } = record.s3.object
      if (!key.endsWith('.car') || !record.eventName.startsWith('ObjectCreated')) {
        logger.error({
          recordEventName: record.eventName,
          key,
          code: 'INVALID_RECORD'
        }, `Ignoring invalid record - Expected ObjectCreated event for .car file`)
        continue
      }
      const file = key.split('/').at(-1)
      const cid = file.split('.').at(0)
      // TODO promise.all/allSettled
      res.push(await updatePinStatus(dynamo, table, cid))
    }
    return toResponse(res)
  } catch (err) {
    logger.error({ err, code: err.code }, 'Error on update pin')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR', err.message)
  }
}

/**
 * Update the pin status for a given CID
 *
 * @param {DynamoDBClient} dynamo
 * @param {cid} string
 * @param {string} status
 */
export async function updatePinStatus (dynamo, table, cid, status = 'pinned') {
  try {
    logger.info({ cid, status }, 'Update pin status')
    const client = DynamoDBDocumentClient.from(dynamo)
    const res = await client.send(new UpdateCommand({
      TableName: table,
      Key: { cid },
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':s': status
      },
      UpdateExpression: 'set #status = :s',
      ReturnValues: 'ALL_NEW'
    }))
    return res.Attributes
  } catch (err) {
    logger.error({ err }, 'Dynamo error')
  }
  throw new ErrorCode('DYNAMO_UPDATE_PIN')
}
