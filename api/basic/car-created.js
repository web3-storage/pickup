import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

/**
 * Set pin status to pinned when receiving an
 * S3 `object_created` event for a .car file.
 *
 * @param {import('aws-lambda').S3Event} event
 */
export async function handler (event) {
  const res = []
  for (const record of event.Records) {
    const { key } = record.s3.object
    if (!key.endsWith('.car') || !record.eventName.startsWith('ObjectCreated')) {
      console.error(`Ignoring '${record.eventName}' event for ${key} - Expected ObjectCreated event for .car file`)
      continue
    }
    const file = key.split('/').at(-1)
    const cid = file.split('.').at(0)
    
    await notifyIndexer(record)
    const pin = await updatePinStatus(cid)
    res.push(pin)
  }
  return res
}

/**
 * Update the pin status for a given CID
 *
 * @param {cid} string
 * @param {string} status
 */
export async function updatePinStatus (cid, status = 'pinned') {
  const {
    TABLE_NAME: table = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined
  } = process.env
  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
  const client = DynamoDBDocumentClient.from(dynamo)
  console.log(`Updating pin status for '${cid}' to '${status}'`)
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
}

/**
 * Send an SQS message witht the S3 path for an S3EventRecord.
 *
 * @param {import('aws-lambda').S3EventRecord} record
 */
 export async function notifyIndexer (record) {
  const {
    SQS_INDEXER_QUEUE_URL: queueUrl,
    SQS_INDEXER_QUEUE_REGION: region,
    // set for testing
    SQS_ENDPOINT: endpoint,
  } = process.env
  const sqs = new SQSClient({ region, endpoint })
  const msg = `${record.awsRegion}/${record.s3.bucket.name}/${record.s3.object.key}`
  sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: msg }))
}