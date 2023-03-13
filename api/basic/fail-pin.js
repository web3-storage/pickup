import retry from 'p-retry'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

/**
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 * @returns {Promise<import('aws-lambda').SQSBatchResponse>}
 */
export async function sqsPinQueueDeadLetterHandler (sqsEvent) {
  const {
    TABLE_NAME: table = '',
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined
  } = process.env
  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
  /** @type {import('aws-lambda').SQSBatchItemFailure[]} */
  const batchItemFailures = []
  for (const msg of sqsEvent.Records) {
    const { cid } = JSON.parse(msg.body)
    try {
      await retry(updatePinStatus(dynamo, table, cid, 'failed'), { retries: 3 })
    } catch (err) {
      console.error(err)
      batchItemFailures.push({ itemIdentifier: msg.messageId })
    }
  }
  // https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting
  return { batchItemFailures }
}

/**
 * Update the pin status for a given CID
 *
 * @param {DynamoDBClient} dynamo
 * @param {string} table
 * @param {string} cid
 * @param {import('./schema').Pin["status"]} status
 */
export async function updatePinStatus (dynamo, table, cid, status) {
  const client = DynamoDBDocumentClient.from(dynamo)
  return client.send(new UpdateCommand({
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
}
