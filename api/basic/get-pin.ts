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
 * AWS API Gateway handler for GET /pins/${cid}
 * Collect the params and delegate to getPin to do the work
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 */
export async function handler (event: APIGatewayProxyEventV2): Promise<Response> {
  const {
    TABLE_NAME: table = '',
    CLUSTER_BASIC_AUTH_TOKEN: token = '',
    CLUSTER_IPFS_ADDR: ipfsAddr = undefined,
    CLUSTER_IPFS_PEERID: ipfsPeerId = undefined,
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined
  } = process.env

  if (event.headers.authorization !== `Basic ${token}`) {
    return { statusCode: 401, body: JSON.stringify({ error: { reason: 'UNAUTHORIZED' } }) }
  }

  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
  const cid = event.pathParameters?.cid ?? ''
  try {
    const pin = await getPin({ cid, dynamo, table })
    const body = toClusterResponse(cid, pin, ipfsAddr, ipfsPeerId)
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

/**
 * Hardcodes much of a cluster shaped response as if it was a single node cluster
 * with just elastic-ipfs as it's single backing node.
 *
 * TODO: Once we know that EP is providing the CID, we update the status to pinned in our db.
 *
 * NOTE: This API is "temporary" to allow us to swap in pickup for cluster. A simpler, non-cluster compatible api can be used onced we are happy that it's a good idea.
 */
export function toClusterResponse (
  cid: string,
  pin?: Pin,
  ipfsAddr = '/dns4/elastic.dag.house/tcp/443/wss/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm',
  ipfsPeerId = ipfsAddr.split('/').at(-1)
): ClusterStatusResponse {
  if (ipfsPeerId === undefined) {
    throw new Error('CLUSTER_IPFS_ADDR must be a valid multiaddr')
  }
  return {
    cid: cid,
    name: '',
    allocations: [],
    origins: [],
    created: pin?.created ?? new Date().toISOString(),
    metadata: null,
    peer_map: {
      // Fake cluster ID to give correct shape to output, not expected to be used. dotStorge dont care.
      '12D3KooWArSKMUUeLk3z2m5LKyb9wGyFL1BtWCT7Gq7Apoo77PUR': {
        peername: 'elastic-ipfs',
        ipfs_peer_id: ipfsPeerId,
        ipfs_peer_addresses: [
          ipfsAddr
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
