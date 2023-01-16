import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {logger} from "pickup-api/basic/helper/logger.js"


/**
 * Update the pin status for a given CID
 *
 * @param {DynamoDBClient} dynamo
 * @param {cid} string
 * @param {string} status
 */
export async function updatePinStatus (dynamo, table, cid, status = 'pinned') {
  try {
    console.info({cid, status}, 'Update pin status')
    const res = await dynamo.send(new UpdateCommand({
      TableName: table,
      Key: {cid},
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':s': status
      },
      UpdateExpression: 'set #status = :s',
      ReturnValues: 'ALL_NEW'
    }))
    console.log('DYNAMO')
    console.log(res)
    return res.Attributes
  } catch(e) {
    console.log('DYNAMO ERROR')

    console.log(e)
  }
}
