import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

export class PinTable {
  /**
   * @param {object} config
   * @param {string} config.table
   * @param {string} config.endpoint
   */
  constructor ({ endpoint, table }) {
    this.table = table
    this.dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint }))
  }

  /**
   * Add multiaddrs to the delegates set for this pin record
   * @param {object} config
   * @param {string} cid
   * @param {Set<string>} delegates
   */
  async addDelegates ({ cid, delegates }) {
    const cmd = new UpdateCommand({
      TableName: this.table,
      Key: { cid },
      ExpressionAttributeValues: {
        ':d': delegates
      },
      UpdateExpression: 'ADD delegates :d',
      ReturnValues: 'ALL_NEW'
    })
    return this.dynamo.send(cmd)
  }
}
