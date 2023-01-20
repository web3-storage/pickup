import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { SQSClient, CreateQueueCommand, GetQueueUrlCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { GenericContainer as Container } from 'testcontainers'
import { addPin, putIfNotExists, handler as addPinHandler } from '../basic/add-pin.js'
import { getPin } from '../basic/get-pin.js'
import { nanoid } from 'nanoid'
import test from 'ava'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

test.before(async t => {
  t.timeout(1000 * 60)

  process.env.LOG_LEVEL = 'silent'

  const dbContainer = await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(8000)
    .start()
  const table = nanoid()
  const dbEndpoint = `http://${dbContainer.getHost()}:${dbContainer.getMappedPort(8000)}`
  const dynamo = new DynamoDBClient({
    endpoint: dbEndpoint
  })
  await dynamo.send(new CreateTableCommand({
    TableName: table,
    AttributeDefinitions: [
      { AttributeName: 'cid', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'cid', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))

  const sqsContainer = await new Container('softwaremill/elasticmq-native:1.3.9')
    .withExposedPorts(9324)
    .start()
  const sqsEndpoint = `http://${sqsContainer.getHost()}:${sqsContainer.getMappedPort(9324)}`
  const sqs = new SQSClient({ endpoint: sqsEndpoint })

  t.context.containers = [dbContainer, sqsContainer]
  t.context.dbEndpoint = dbEndpoint
  t.context.dynamo = dynamo
  t.context.table = table
  t.context.sqsEndpoint = sqsEndpoint
  t.context.sqs = sqs
  t.context.createQueue = createQueue.bind(null, sqsContainer.getMappedPort(9324), sqs)

  t.context.lambdaContext = {
    awsRequestId: 123123
  }
})

test('addPin for the first time', async t => {
  const { dynamo, table, sqs, createQueue } = t.context
  const queueUrl = await createQueue()
  const bucket = 'foo'
  const cid = nanoid()
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']
  const res = await addPin({ cid, origins, bucket: 'foo', dynamo, table, sqs, queueUrl })

  t.is(res.cid, cid)
  t.is(res.origins[0], origins[0])
  t.is(res.type, 'pin')
  const msgs = await getMessagesFromSQS({ queueUrl, length: 2, sqs })
  t.is(msgs.length, 1)
  const msg = JSON.parse(msgs[0].Body)
  t.is(msg.cid, cid)
  t.is(msg.origins[0], origins[0])
  t.is(msg.bucket, bucket)
  t.is(msg.key, `pickup/${cid}/${cid}.root.car`)
})

test('addPin for a failed item', async t => {
  const { dynamo, table, sqs, createQueue } = t.context
  const queueUrl = await createQueue()
  const bucket = 'foo'
  const cid = nanoid()
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']

  await putIfNotExists({ cid, dynamo, table })
  const client = DynamoDBDocumentClient.from(dynamo)
  await client.send(new UpdateCommand({
    TableName: table,
    Key: { cid },
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':s': 'failed'
    },
    UpdateExpression: 'set #status = :s',
    ReturnValues: 'ALL_NEW'
  }))

  const res = await addPin({ cid, origins, bucket: 'foo', dynamo, table, sqs, queueUrl })

  t.is(res.cid, cid)
  t.is(res.origins[0], origins[0])
  t.is(res.type, 'pin')
  const msgs = await getMessagesFromSQS({ queueUrl, length: 2, sqs })
  t.is(msgs.length, 1)
  const msg = JSON.parse(msgs[0].Body)
  t.is(msg.cid, cid)
  t.is(msg.origins[0], origins[0])
  t.is(msg.bucket, bucket)
  t.is(msg.key, `pickup/${cid}/${cid}.root.car`)
})

test('addPin for an item already queued', async t => {
  const { dynamo, table, sqs, createQueue } = t.context
  const queueUrl = await createQueue()
  const cid = nanoid()
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']

  const res1 = await addPin({ cid, origins, bucket: 'foo', dynamo, table, sqs, queueUrl })
  const res2 = await addPin({ cid, origins, bucket: 'foo', dynamo, table, sqs, queueUrl })

  t.is(res1.cid, cid)
  t.is(res1.origins[0], origins[0])
  t.is(res1.type, 'pin')

  t.is(res2.cid, res1.cid)
  t.deepEqual(res2.origins, res1.origins)
  t.is(res2.type, res1.type)

  const msgs = await getMessagesFromSQS({ queueUrl, length: 2, sqs })
  t.is(msgs.length, 1)
})

test('addPin for an item already pinned', async t => {
  const { dynamo, table, sqs, createQueue } = t.context
  const queueUrl = await createQueue()
  const cid = nanoid()
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']

  await putIfNotExists({ cid, dynamo, table })
  const client = DynamoDBDocumentClient.from(dynamo)
  await client.send(new UpdateCommand({
    TableName: table,
    Key: { cid },
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':s': 'pinned'
    },
    UpdateExpression: 'set #status = :s',
    ReturnValues: 'ALL_NEW'
  }))

  const res1 = await addPin({ cid, origins, bucket: 'foo', dynamo, table, sqs, queueUrl })

  t.is(res1.cid, cid)
  t.is(res1.origins[0], origins[0])
  t.is(res1.type, 'pin')

  const msgs = await getMessagesFromSQS({ queueUrl, length: 2, sqs })
  t.is(msgs, undefined)
})

test('putIfNotExists', async t => {
  const cid = nanoid()
  const { dynamo, table } = t.context
  const res1 = await putIfNotExists({ cid, dynamo, table })
  t.is(res1.shouldQueue, true)
  t.is(res1.pin.cid, cid)
  t.is(res1.pin.status, 'queued')

  const res2 = await getPin({ cid, dynamo, table })
  t.is(res2.cid, cid)
  t.is(res2.status, 'queued')
  t.is(res2.created, res1.pin.created)

  const res3 = await putIfNotExists({ cid, dynamo, table })
  t.is(res3.shouldQueue, false)
  t.is(res3.pin.cid, cid)
  t.is(res3.pin.status, 'queued')
  t.is(res3.pin.created, res1.pin.created)
})

test('putIfNotExists with a failed status', async t => {
  const cid = nanoid()
  const { dynamo, table } = t.context
  const res1 = await putIfNotExists({ cid, dynamo, table })
  t.is(res1.shouldQueue, true)
  t.is(res1.pin.cid, cid)
  t.is(res1.pin.status, 'queued')

  const client = DynamoDBDocumentClient.from(dynamo)
  await client.send(new UpdateCommand({
    TableName: table,
    Key: { cid },
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':s': 'failed'
    },
    UpdateExpression: 'set #status = :s',
    ReturnValues: 'ALL_NEW'
  }))

  const res2 = await getPin({ cid, dynamo, table })
  t.is(res2.cid, cid)
  t.is(res2.status, 'failed')
  t.is(res2.created, res1.pin.created)

  const res3 = await putIfNotExists({ cid, dynamo, table })
  t.is(res3.shouldQueue, true)
  t.is(res3.pin.cid, cid)
  t.is(res3.pin.status, 'queued')
  t.truthy(res3.pin.created > res1.pin.created)
})

test('addPin basic auth', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.SQS_ENDPOINT = t.context.sqsEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.BUCKET_NAME = t.context.bucket
  process.env.QUEUE_URL = await t.context.createQueue()
  const event = {
    headers: {
      authorization: 'nope'
    },
    pathParameters: {
      cid: 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'
    }
  }
  const unauth = await addPinHandler(event, t.context.lambdaContext)
  t.is(unauth.statusCode, 401)
  t.true(typeof unauth.body === 'string')
  t.deepEqual(JSON.parse(unauth.body), { error: { reason: 'UNAUTHORIZED' } })

  event.headers.authorization = `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
  const auth = await addPinHandler(event, t.context.lambdaContext)
  t.is(auth.statusCode, 200)
})

export async function createQueue (sqsPort, sqs) {
  const QueueName = nanoid()
  await sqs.send(new CreateQueueCommand({
    QueueName,
    Attributes: {
      DelaySeconds: '0',
      MessageRetentionPeriod: '10'
    }
  }))
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName }))
  return QueueUrl.replace('9324', sqsPort)
}

export async function getMessagesFromSQS ({ queueUrl, length, sqs }) {
  const result = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: length,
    WaitTimeSeconds: 1
  }))

  return result.Messages
}
