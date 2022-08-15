import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ClusterStatusResponse, Pin, Response } from './schema.js'

interface GetPinInput {
  cid: string
  dynamo: DynamoDBClient
  table: string
}

/**
 * AWS API Gateway handler for POST /pin/${cid}?&origins=${multiaddr},${multiaddr}
 * Collect the params and delegate to addPin to do the work
 * 
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 */
export async function handler (event: APIGatewayProxyEventV2): Promise<Response> {
  const {
    TABLE_NAME: table = '',
    DYNAMO_DB_ENDPOINT: endpoint = undefined,
    CLUSTER_BASIC_AUTH_TOKEN: token = ''
  } = process.env
  if (event.headers.authorization !== `Basic ${token}`) {
    return { statusCode: 401, body: { error: { reason: 'UNAUTHORIZED' } } }
  }
  const dynamo = new DynamoDBClient({endpoint})
  const cid = event.pathParameters?.cid ?? ''
  try {
    const pin = await getPin({ cid, dynamo, table })
    const body = toClusterResponse(cid, pin)
    return { statusCode: 200, body: JSON.stringify(body) }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}

export const getPin = async ({ cid, dynamo, table }: GetPinInput): Promise<Pin | undefined> => {
  const client = DynamoDBDocumentClient.from(dynamo)

  const res = await client.send(new GetCommand({
    TableName: table,
    Key: { cid }
  }))

  const pin = res.Item as Pin

  return pin
}

export function toClusterResponse (cid: string, pin?: Pin): ClusterStatusResponse {
  return {
    cid: cid,
    name: '',
    allocations: [],
    origins: [],
    created: pin?.created ?? new Date().toISOString(),
    metadata: null,
    peer_map: {
      '12D3KooWArSKMUUeLk3z2m5LKyb9wGyFL1BtWCT7Gq7Apoo77PUR': {
        peername: 'elastic-ipfs',
        ipfs_peer_id: 'bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm',
        ipfs_peer_addresses: [
          '/dns4/peer.ipfs-elastic-provider-aws.com/tcp/3000/ws/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm'
        ],
        status: pin?.status ?? 'unpinned',
        timestamp: new Date().toISOString(),
        error: '',
        attempt_count: 0,
        priority_pin: false
      }
    }
  }
}
