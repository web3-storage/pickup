import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { logger } from './logger.js'

/**
 * Update the pin status for a given CID
 *
 * @param {DynamoDBClient} dynamo
 * @param {cid} string
 * @param {string} status
 */
export async function updatePinStatus (dynamo, table, cid, status = 'pinned') {
  try {
    logger.trace({ cid, status }, 'Dynamo try to update pin status')

    const res = await dynamo.send(new UpdateCommand({
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

    logger.trace({ res, cid, status }, 'Dynamo pin status updated')
    return res.Attributes
  } catch (err) {
    logger.error({ cid, status }, 'Dynamo pin status error')
    throw err
  }
}
