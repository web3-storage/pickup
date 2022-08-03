import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { Pin } from './schema.js'

interface GetPinInput {
  cid: string
  dynamo: DynamoDBClient
  table: string
}

export const getPin = async ({ cid, dynamo, table }: GetPinInput): Promise<Pin | undefined> => {
  const client = DynamoDBDocumentClient.from(dynamo)

  const res = await client.send(new GetCommand({
    TableName: table,
    Key: { cid }
  }))

  return res.Item as Pin
}
