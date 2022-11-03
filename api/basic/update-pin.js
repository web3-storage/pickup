import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

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
 * Set pin status to pinned when receiving an
 * S3 `object_created` event for a .car file.
 *
 * @param {import('aws-lambda').S3Event} event
 */
export async function s3EventHandler (event) {
  const {
    TABLE_NAME: table = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined
  } = process.env

  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })

  const res = []
  for (const record of event.Records) {
    const { key } = record.s3.object
    if (!key.endsWith('.car') || !record.eventName.startsWith('ObjectCreated')) {
      console.error(`Ignoring '${record.eventName}' event for ${key} - Expected ObjectCreated event for .car file`)
      continue
    }
    const file = key.split('/').at(-1)
    const cid = file.split('.').at(0)
    res.push(await updatePinStatus(dynamo, table, cid))
  }
  return res
}

/**
 * Update the pin status for a given CID
 *
 * @param {DynamoDBClient} dynamo
 * @param {cid} string
 * @param {string} status
 */
export async function updatePinStatus (dynamo, table, cid, status = 'pinned') {
  console.log(`Updating pin status for '${cid}' to '${status}'`)
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
}
