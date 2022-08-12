import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { SQSClient, CreateQueueCommand, GetQueueUrlCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { GenericContainer as Container } from 'testcontainers'
import { addPin, putIfNotExists } from '../basic/add-pin.js'
import { getPin } from '../basic/get-pin.js'
import { nanoid } from 'nanoid'
import test from 'ava'

test.before(async t => {
  t.timeout(1000 * 60)
  const dbContainer = await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(8000)
    .start()
  const table = nanoid()
  const dynamo = new DynamoDBClient({
    endpoint: `http://${dbContainer.getHost()}:${dbContainer.getMappedPort(8000)}`
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
  const sqs = new SQSClient({
    endpoint: `http://${sqsContainer.getHost()}:${sqsContainer.getMappedPort(9324)}`
  })
  t.context.containers = [dbContainer, sqsContainer]
  t.context.dynamo = dynamo
  t.context.table = table
  t.context.sqs = sqs
  t.context.createQueue = createQueue.bind(null, sqsContainer.getMappedPort(9324), sqs)
})

test.after.always(async t => {
  t.context.containers.forEach(t => t.stop())
})

test('getPin', async t => {
  const cid = 'foo'
  const { dynamo, table } = t.context
  const res1 = await getPin({ cid, dynamo, table })
  t.is(res1, undefined)

  const res2 = await putIfNotExists({ cid, dynamo, table })

  const res3 = await getPin({ cid, dynamo, table })
  t.is(res3.cid, cid)
  t.is(res3.status, res2.status)
  t.is(res3.created, res2.created)
})

test('addPin', async t => {
  const { dynamo, table, sqs, createQueue } = t.context
  const queueUrl = await createQueue()
  const bucket = 'foo'
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']
  const res = await addPin({ cid, origins, bucket: 'foo', dynamo, table, sqs, queueUrl })
  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.is(res.body.origins[0], origins[0])
  t.is(res.body.type, 'pin')
  const msgs = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 0 }))
  const msg = JSON.parse(msgs.Messages[0].Body)
  t.is(msg.cid, cid)
  t.is(msg.origins[0], origins[0])
  t.is(msg.bucket, bucket)
  t.is(msg.key, `pickup/${cid}/${cid}.root.car`)
})

test('addPin bad cid', async t => {
  const { dynamo, table, sqs } = t.context
  const cid = 'bar'
  const res = await addPin({ cid, origins: [], bucket: 'foo', dynamo, table, sqs, queueUrl: 'meh' })
  t.is(res.statusCode, 400)
  t.is(res.body.error.details, `${cid} is not a valid CID`)
})

test('addPin bad multiaddr', async t => {
  const { dynamo, table, sqs } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = ['nope']
  const res = await addPin({ cid, origins, bucket: 'foo', dynamo, table, sqs, queueUrl: 'meh' })
  t.is(res.statusCode, 400)
  t.is(res.body.error.details, `${origins[0]} in origins is not a valid multiaddr`)
})

test('putIfNotExists', async t => {
  const cid = 'bar'
  const { dynamo, table } = t.context
  const res1 = await putIfNotExists({ cid, dynamo, table })
  t.is(res1.cid, cid)
  t.is(res1.status, 'queued')

  const res2 = await getPin({ cid, dynamo, table })
  t.is(res2.cid, cid)
  t.is(res2.status, 'queued')
  t.is(res2.created, res1.created)

  const res3 = await putIfNotExists({ cid, dynamo, table })
  t.is(res3.cid, cid)
  t.is(res3.status, 'queued')
  t.is(res3.created, res1.created)
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
