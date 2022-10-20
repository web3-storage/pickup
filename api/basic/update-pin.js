import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

/**
 * @param {import('aws-lambda').S3Event} event
 */
export async function handler (event) {
  const {
    TABLE_NAME: table = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined
  } = process.env

  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })

  const res = []
  for (const record of event.Records) {
    const { key } = record.s3.object
    if (!key.endsWith('.car')) {
      continue
    }
    const file = key.split('/').at(-1) 
    const cid = file.split('.').at(0)
    res.push(await updatePinStatus(dynamo, table, cid))
    // TODO: notify indexer, or do as seperate lambda
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
