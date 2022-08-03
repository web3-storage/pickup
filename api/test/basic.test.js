import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { GenericContainer as Container } from 'testcontainers'
import { putIfNotExists } from '../basic/add-pin.js'
import { getPin } from '../basic/get-pin.js'
import { nanoid } from 'nanoid'
import test from 'ava'

test.before(async t => {
  t.timeout(1000 * 60)
  const container = await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(8000)
    .start()
  const table = nanoid()
  const dynamo = new DynamoDBClient({
    endpoint: `http://${container.getHost()}:${container.getMappedPort(8000)}`
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
  t.context.container = container
  t.context.dynamo = dynamo
  t.context.table = table
})

test.after.always(async t => {
  await t.container?.stop()
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

test('upsertPin', async t => {
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
