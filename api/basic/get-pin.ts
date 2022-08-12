import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { Pin, Response } from './schema.js'

const dynamo = new DynamoDBClient({})

interface GetPinInput {
  cid: string
  dynamo: DynamoDBClient
  table: string
}

interface ClusterStatusResponse {
  'cid': string
  'name': ''
  'allocations': []
  'origins': []
  'created': string
  'metadata': null
  'peer_map': {
    '12D3KooWArSKMUUeLk3z2m5LKyb9wGyFL1BtWCT7Gq7Apoo77PUR': {
      'peername': 'elastic-ipfs'
      'ipfs_peer_id': 'bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm'
      'ipfs_peer_addresses': [
        '/dns4/peer.ipfs-elastic-provider-aws.com/tcp/3000/ws/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm',
      ]
      'status': Pin['status']
      'timestamp': string
      'error': ''
      'attempt_count': 0
      'priority_pin': false
    }
  }
}

/**
 * AWS API Gateway handler for POST /pin/${cid}?&origins=${multiaddr},${multiaddr}
 * Collect the params and delegate to addPin to do the work
 */
export async function handler (event: APIGatewayProxyEventV2): Promise<Response> {
  const { TABLE_NAME: table = '' } = process.env
  const cid = event.pathParameters?.cid ?? ''
  try {
    const pin = await getPin({ cid, dynamo, table })
    const body = toClusterResponse(cid, pin)
    return { statusCode: 200, body }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR' } } }
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
