import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { GenericContainer as Container } from 'testcontainers'
import DynamoDBPinningService, { PinStatusVals } from '../db.js'
import { nanoid } from 'nanoid'
import test from 'ava'

test.before(async t => {
  t.timeout(1000 * 60)

  const container = await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(8000)
    .start()

  const table = 'TEST'
  const db = new DynamoDBPinningService({
    table,
    client: new DynamoDBClient({
      endpoint: `http://${container.getHost()}:${container.getMappedPort(8000)}`
    })
  })
  await db.client.send(new CreateTableCommand({
    TableName: table,
    AttributeDefinitions: [
      { AttributeName: 'userid', AttributeType: 'S' },
      { AttributeName: 'requestid', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'userid', KeyType: 'HASH' },
      { AttributeName: 'requestid', KeyType: 'RANGE' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))
  t.context.container = container
  t.context.db = db
})

test.after.always(async t => {
  await t.container?.stop()
})

test('add a pin', async t => {
  const { db } = t.context
  // set a unique userid per test to isolate as they run in parallel against shared db
  const userid = nanoid()
  const cid = 'test-cid'
  const res = await db.addPin(userid, { cid })
  t.is(res.userid, undefined, 'userid should not be set')
  t.is(res.pin.cid, cid)
  t.is(res.status, 'queued')
  t.regex(res.requestid, /\S{26,}/, 'request id is 26 or more non-white space chars')
  t.regex(res.created, /\S{24,}/, 'created date is 24 or more non-white space chars')
})

test('get pins', async t => {
  const { db } = t.context
  const userid = nanoid()
  let res = await db.getPins(userid, {})
  t.like(res, {
    count: 0,
    results: []
  })

  const cid = 'test-cid'
  await db.addPin(userid, { cid })

  // should only return `pinned` pins by default
  res = await db.getPins(userid, {})
  t.like(res, {
    count: 0,
    results: []
  })

  // should return pins by status
  res = await db.getPins(userid, { status: ['queued'] })
  t.is(res.count, 1)
  t.is(res.results.length, 1)
  t.is(res.results[0].status, 'queued')
  t.is(res.results[0].pin.cid, cid)
  t.is(res.results[0].userid, undefined, 'userid should not be set')
  t.regex(res.results[0].requestid, /\S{26,}/, 'request id is 26 or more non-white space chars')
  t.regex(res.results[0].created, /\S{24,}/, 'created date is 24 or more non-white space chars')
})

test('get pins latest first', async t => {
  const { db } = t.context
  const userid = nanoid()
  await db.addPin(userid, { cid: '#1' })
  await db.addPin(userid, { cid: '#2' })
  await db.addPin(userid, { cid: '#3' })

  // should return pins by status
  const res = await db.getPins(userid, { status: ['queued'] })
  t.is(res.count, 3)
  t.is(res.results[0].pin.cid, '#3')
  t.is(res.results[1].pin.cid, '#2')
  t.is(res.results[2].pin.cid, '#1')
})

test('get pins by status', async t => {
  const { db } = t.context
  const userid = nanoid()
  for (const status of PinStatusVals) {
    const res = await db.addPin(userid, { cid: `test-${status}` })
    await db.updatePinStatusByRequestId(userid, res.requestid, status)
  }

  // only get pins for status
  for (const status of PinStatusVals) {
    const res = await db.getPins(userid, { status: [status] })
    t.is(res.count, 1)
    t.is(res.results[0].pin.cid, `test-${status}`)
    t.is(res.results[0].status, status)
  }

  // sending multiple statuses means a AND b.
  const res = await db.getPins(userid, { status: PinStatusVals })
  t.is(res.count, 4)
})
