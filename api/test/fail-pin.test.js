import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { GenericContainer as Container } from 'testcontainers'
import { upsertOnDynamo } from '../basic/add-pin.js'
import { getPin } from '../basic/get-pin.js'
import { sqsPinQueueDeadLetterHandler } from '../basic/fail-pin.js'
import { nanoid } from 'nanoid'
import test from 'ava'

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

  t.context.containers = [dbContainer]
  t.context.dbEndpoint = dbEndpoint
  t.context.dynamo = dynamo
  t.context.table = table

  t.context.lambdaContext = {
    awsRequestId: 123123
  }
})

test('sqsPinQueueDeadLetterHandler', async t => {
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  const cid = 'fail'
  const { dynamo, table } = t.context
  const res1 = await getPin({ cid, dynamo, table })
  t.is(res1, undefined)

  const res2 = await upsertOnDynamo({ cid, dynamo, table })

  const res3 = await getPin({ cid, dynamo, table })
  t.is(res3.cid, cid)
  t.is(res3.status, res2.pin.status)
  t.is(res3.created, res2.pin.created)

  const sqsEvent = {
    Records: [{
      messageId: 'testId',
      body: JSON.stringify({
        cid,
        origins: []
      })
    }]
  }

  const res4 = await sqsPinQueueDeadLetterHandler(sqsEvent)
  t.like(res4, { batchItemFailures: [] })

  const res5 = await getPin({ cid, dynamo, table })
  t.is(res5.cid, cid)
  t.is(res5.status, 'failed')
  t.is(res5.created, res2.pin.created)
})
