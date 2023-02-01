import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { logger } from './logger.js'

/**
 * Update the pin status for a given CID
 *
 * @param {DynamoDBClient} dynamo
 * @param {cid} string
 * @param {string} status
 */
export async function updatePinStatus ({ dynamo, table, cid, status, error }) {
  try {
    logger.trace({ cid, status }, 'Dynamo try to update pin status')

    const command = {
      TableName: table,
      Key: { cid },
      ExpressionAttributeNames: {
        '#status': 'status',
        '#error': 'error',
        '#downloadFailedAt': 'downloadFailedAt'
      },
      ExpressionAttributeValues: {
        ':s': status,
        ':e': error || '',
        ':df': new Date().toISOString()
      },
      UpdateExpression: 'set #status = :s, #error = :e, #downloadFailedAt = :df',
      ReturnValues: 'ALL_NEW'
    }

    logger.trace({ cid, command }, 'Dynamo command')
    const res = await dynamo.send(new UpdateCommand(command))

    logger.trace({ res, cid, status }, 'Dynamo pin status updated')
    return res.Attributes
  } catch (err) {
    logger.error({ cid, status }, 'Dynamo pin status error')
    throw err
  }
}
