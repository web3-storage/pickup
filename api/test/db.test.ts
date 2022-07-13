import { nanoid } from 'nanoid'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { GenericContainer as Container, StartedTestContainer } from 'testcontainers'
import DynamoDBPinningService, { PinStatusVals } from '../db'

describe('DynamoDBPinningService', () => {
  let container: StartedTestContainer
  let db: DynamoDBPinningService

  beforeAll(async () => {
    container = await new Container('amazon/dynamodb-local:latest')
      .withExposedPorts(8000)
      .start()

    const table = 'TEST'
    db = new DynamoDBPinningService({
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
  }, 1000 * 60 * 10)

  afterAll(async () => {
    await container.stop()
  })

  it('should add a pin', async () => {
    // set a unique userid per test to isolate as they run in parallel against shared db
    const userid = nanoid()
    const cid = 'test-cid'
    const res = await db.addPin(userid, { cid })
    expect(res).not.toHaveProperty('userid')
    expect(res).toMatchObject({
      requestid: expect.stringMatching(/\S{26,}/), // 26 or more non-white space chars
      status: 'queued',
      created: expect.stringMatching(/\S{24}/), // 24 non-white space chars
      pin: {
        cid
      }
    })
  })

  it('should get pins', async () => {
    const userid = nanoid()
    let res = await db.getPins(userid, {})
    expect(res).not.toHaveProperty('userid')
    expect(res).toMatchObject({
      count: 0,
      results: []
    })

    const cid = 'test-cid'
    await db.addPin(userid, { cid })

    // should only return `pinned` pins by default
    res = await db.getPins(userid, {})
    expect(res).not.toHaveProperty('userid')
    expect(res).toMatchObject({
      count: 0,
      results: []
    })

    // should return pins by status
    res = await db.getPins(userid, { status: ['queued'] })
    expect(res).not.toHaveProperty('userid')
    expect(res).toMatchObject({
      count: 1,
      results: [{
        requestid: expect.stringMatching(/\S{26,}/), // 26 or more non-white space chars
        status: 'queued',
        created: expect.stringMatching(/\S{24}/), // 24 non-white space chars
        pin: {
          cid
        }
      }]
    })
    expect(res.results[0]).not.toHaveProperty('userid')
  })

  it('should get pins latest first', async () => {
    const userid = nanoid()
    await db.addPin(userid, { cid: '#1' })
    await db.addPin(userid, { cid: '#2' })
    await db.addPin(userid, { cid: '#3' })

    // should return pins by status
    const res = await db.getPins(userid, { status: ['queued'] })
    expect(res.count).toBe(3)
    expect(res.results[0].pin.cid).toBe('#3')
    expect(res.results[1].pin.cid).toBe('#2')
    expect(res.results[2].pin.cid).toBe('#1')
  })

  it('should get pins by status', async () => {
    const userid = nanoid()
    for (const status of PinStatusVals) {
      const res = await db.addPin(userid, { cid: `test-${status}` })
      await db.updatePinStatusByRequestId(userid, res.requestid, status)
    }

    // only get pins for status
    for (const status of PinStatusVals) {
      const res = await db.getPins(userid, { status: [status] })
      expect(res.count).toBe(1)
      expect(res.results[0].pin.cid).toBe(`test-${status}`)
      expect(res.results[0].status).toBe(status)
    }

    // sending multiple statuses means a AND b.
    const res = await db.getPins(userid, { status: PinStatusVals })
    expect(res.count).toBe(4)
  })
})
