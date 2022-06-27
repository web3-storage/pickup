import { nanoid } from 'nanoid'
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, QueryCommandInput, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { PinResults, PinStatus, Pin, PinQuery, Status } from './schema'

// used to filter props when querying dynamodb
export const PinStatusAttrs = ['requestid', 'status', 'created', 'pin', 'delegates', 'info']
export const PinStatusVals: Status[] = ["queued", "pinning", "pinned", "failed"]

export default class DynamoDBPinningService {
  table: string
  client: DynamoDBDocumentClient

  constructor ({table = 'PinStatus', client = new DynamoDBClient({})} = {}) {
    this.table = table
    this.client = DynamoDBDocumentClient.from(client)
  }

  /**
   * Insert a new PinStatus for userid
   */
  async addPin (userid: string, pin: Pin): Promise<PinStatus> {
    const status: PinStatus = {
      requestid: `${Date.now()}-${nanoid(13)}`,
      status: 'queued',
      created: new Date().toISOString(),
      pin,
      delegates: [],
      info: {}
    }
    await this.client.send(new PutCommand({ 
      TableName: this.table, 
      Item: {
        ...status,
        userid
      } 
    }))
    return status
  }
  
  /**
   * Find PinStatus objects for userid that match query. Returns pins with status: `pinned` by default
   */
  async getPins (userid: string, query: PinQuery): Promise<PinResults> {
    const status = Array.isArray(query.status) ? query.status : Array.of(query.status || 'pinned')  
    const dbQuery: QueryCommandInput = { 
      TableName: this.table,
      // gotta sidestep dynamo reserved words!?
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: { 
        ":u": userid,
        ...toInFilter(status).Values
      },
      KeyConditionExpression: "userid = :u",
      FilterExpression: `#status IN (${toInFilter(status).Expresssion})`,
      ProjectionExpression: PinStatusAttrs.map(x => x === 'status' ? '#status' : x).join(', '),
      ScanIndexForward: false, // most recent pins first plz
      Limit: Number(query.limit) || 10
    }
    const res = await this.client.send(new QueryCommand(dbQuery))
    const body: PinResults = { 
      count: res.Count || 0, 
      results: res.Items as PinStatus[]
    }
    return body
  }

  /**
   * 
   */
  async getPinByRequestId (userid: string, requestid: string): Promise<PinStatus> {
    const res = await this.client.send(new GetCommand({ 
      TableName: this.table, 
      Key: { userid, requestid },
      AttributesToGet: PinStatusAttrs
    }))
    return res.Item as PinStatus
  }

  /**
   * Replace an existing pin object. Intended to be a shortcut for executing 
   * remove and add operations in one step to avoid unnecessary garbage 
   * collection of blocks present in both recursive pins... but we're gonna do
   * it the hard way, as we're all CARs in S3, not blocks in a shared blockstore.
   */
  async replacePinByRequestId (userid: string, requestid: string, pin: Pin): Promise<PinStatus>  {
    throw new Error('Not Implemented')
  }

  /**
   * Remove a pin object
   */
  async deletePinByRequestId (userid: string, requestid: string): Promise<void> {
    throw new Error('Not Implemented')
  }

  /**
   * Update the state for a given Pin
   */
  async updatePinStatusByRequestId(userid: string, requestid: string, status: Status): Promise<PinStatus> {
    if (!PinStatusVals.includes(status)) {
      throw new Error(`Cannot update pin status to ${status}. Must be one of ${PinStatusVals.join(', ')}`)
    }
    const res = await this.client.send(new UpdateCommand({ 
      TableName: this.table, 
      Key: { userid, requestid },
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':s': status
      },
      UpdateExpression: 'set #status = :s',
      ReturnValues: "ALL_NEW"
    }))
    // @ts-ignore ReturnValues on query mean res.Item exists.
    return res.Item as PinStatus
  }
}

// gross. i have no idea how they expect you to write an IN query with this shit.
export function toInFilter(arr: string[]) {
  const Expresssion = arr.map(k => `:${k}`).join(', ')
  let Values = {}
  // @ts-ignore
  arr.forEach(k => Values[`:${k}`] = k)
  return { Expresssion, Values }
}