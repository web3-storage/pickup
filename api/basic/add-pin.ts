import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ClusterAddResponse, Pin, Response } from './schema.js'
import { CID } from 'multiformats/cid'
import { Multiaddr } from 'multiaddr'
import { nanoid } from 'nanoid'

interface UpsertPinInput {
  cid: string
  dynamo: DynamoDBClient
  table: string
}

interface AddToQueueInput {
  cid: string
  origins: string[]
  bucket: string
  sqs: SQSClient
  queueUrl: string
}

// type AddPinInput = AddToQueueInput & UpsertPinInput
interface AddPinInput extends UpsertPinInput, AddToQueueInput {}

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
    BUCKET_NAME: bucket = '',
    QUEUE_URL: queueUrl = '',
    CLUSTER_BASIC_AUTH_TOKEN: token = '',
    // set for testing
    SQS_ENDPOINT: sqsEndpoint = undefined,
    DYNAMO_DB_ENDPOINT: dbEndpoint = undefined
  } = process.env

  if (event.headers.authorization !== `Basic ${token}`) {
    return { statusCode: 401, body: JSON.stringify({ error: { reason: 'UNAUTHORIZED' } }) }
  }

  const sqs = new SQSClient({ endpoint: sqsEndpoint })
  const dynamo = new DynamoDBClient({ endpoint: dbEndpoint })
  const cid = event.pathParameters?.cid ?? ''
  const origins = event.queryStringParameters?.origins?.split(',') ?? []
  try {
    const res = await addPin({ cid, origins, bucket, sqs, queueUrl, dynamo, table })
    return { ...res, body: JSON.stringify(res.body) }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}

/**
 * Handle a request to pin a CID.
 * Returns existing Pin info if we have it, otherwise inserts a Pin record to
 * DynamoDB and adds a message to SQS to kick off a pickup of the requested CID
 * with optional source multiaddrs specified as origins list.
 */
export async function addPin ({ cid, origins, bucket, sqs, queueUrl, dynamo, table }: AddPinInput): Promise<Response> {
  if (bucket === null || bucket === '') {
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'BUCKET_NAME must be set in ENV' } } }
  }
  if (queueUrl === null || queueUrl === '') {
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'QUEUE_URL must be set in ENV' } } }
  }
  if (table === null || table === '') {
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'QUEUE_URL must be set in ENV' } } }
  }
  if (cid === null || cid === '') {
    return { statusCode: 400, body: { error: { reason: 'BAD_REQUEST', details: 'CID not found in path' } } }
  }
  if (!isCID(cid)) {
    return { statusCode: 400, body: { error: { reason: 'BAD_REQUEST', details: `${cid} is not a valid CID` } } }
  }
  for (const str of origins) {
    if (!isMultiaddr(str)) {
      return { statusCode: 400, body: { error: { reason: 'BAD_REQUEST', details: `${str} in origins is not a valid multiaddr` } } }
    }
  }
  const pin = await putIfNotExists({ cid, dynamo, table })
  await addToQueue({ cid, origins, bucket, sqs, queueUrl })
  const body = toClusterResponse(pin, origins)
  return { statusCode: 200, body }
}

export function toClusterResponse (pin: Pin, origins: string[]): ClusterAddResponse {
  return {
    replication_factor_min: -1,
    replication_factor_max: -1,
    name: '',
    mode: 'recursive',
    shard_size: 0,
    user_allocations: null,
    expire_at: '0001-01-01T00:00:00Z',
    metadata: {},
    pin_update: null,
    origins: origins,
    cid: pin.cid,
    type: 'pin',
    allocations: [],
    max_depth: -1,
    reference: null,
    timestamp: pin.created
  }
}

/**
 * Save Pin to Dynamo. If we already have that CID then return the existing.
 */
export async function putIfNotExists ({ cid, dynamo, table }: UpsertPinInput): Promise<Pin> {
  const client = DynamoDBDocumentClient.from(dynamo)
  const pin: Pin = {
    cid,
    status: 'queued',
    created: new Date().toISOString()
  }
  try {
    await client.send(new PutCommand({
      TableName: table,
      Item: pin,
      ConditionExpression: 'attribute_not_exists(cid)'
    }))
    // Pin was saved, so return it
    return pin
  } catch (err) {
    // expected error if CID already exists
    if (err instanceof ConditionalCheckFailedException) {
      const existing = await client.send(new GetCommand({
        TableName: table,
        Key: { cid }
      }))
      return existing.Item as Pin
    }
  }
  throw new Error('Failed to save Pin. Please try again')
}

/**
 * Send message to SQS for pickup to fetch that CID
 */
async function addToQueue ({ cid, origins, sqs, queueUrl, bucket }: AddToQueueInput): Promise<void> {
  const requestid = `${Date.now()}-${nanoid(13)}`
  const message = {
    requestid,
    cid,
    origins,
    bucket,
    key: `pickup/${cid}/${cid}.root.car`
  }
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }))
}

function isMultiaddr (input = ''): boolean {
  if (input === '' || input === null) return false
  try {
    new Multiaddr(input) // eslint-disable-line no-new
    return true
  } catch (e) {
    return false
  }
}

export function isCID (str = ''): boolean {
  try {
    return Boolean(CID.parse(str))
  } catch (err) {
    return false
  }
}
