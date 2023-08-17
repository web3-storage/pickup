import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb'

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
   * @param {string} config.cid
   * @param {Set<string>} config.delegates
   */
  async addDelegates ({ cid, delegates }) {
    if (!delegates || delegates.size === 0) {
      throw new Error('addDelegates requires 1 or more delegates')
    }
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

  /**
   * Get a single Pin record
   * @param {object} config
   * @param {string} config.cid
   */
  async getPin ({ cid }) {
    const cmd = new GetCommand({
      TableName: this.table,
      Key: { cid }
    })
    const res = await this.dynamo.send(cmd)
    return res.Item
  }

  /**
   * Update the pin status for a given CID
   *
   * @param {object} config
   * @param {string} config.cid
   * @param {string} [config.status]
   */
  async updatePinStatus ({ cid, status = 'pinned' }) {
    const res = await this.dynamo.send(new UpdateCommand({
      TableName: this.table,
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
}
