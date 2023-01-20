import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { GenericContainer as Container } from 'testcontainers'
import { putIfNotExists } from '../basic/add-pin.js'
import { getPin } from '../basic/get-pin.js'
import { s3EventHandler as updatePin } from '../basic/update-pin.js'
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

test('updatePinStatus', async t => {
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  const cid = 'update'
  const { dynamo, table } = t.context
  const res1 = await getPin({ cid, dynamo, table })
  t.is(res1, undefined)

  const res2 = await putIfNotExists({ cid, dynamo, table })

  const res3 = await getPin({ cid, dynamo, table })
  t.is(res3.cid, cid)
  t.is(res3.status, res2.pin.status)
  t.is(res3.created, res2.pin.created)

  const s3Event = {
    Records: [{
      eventName: 'ObjectCreated:Put',
      s3: {
        object: {
          key: `pickup/${cid}.car`
        }
      }
    }]
  }

  const res = await updatePin(s3Event, t.context.lambdaContext)
  const [res4] = JSON.parse(res.body)
  t.is(res4.cid, cid)
  t.is(res4.status, 'pinned')
  t.is(res4.created, res2.pin.created)
})
