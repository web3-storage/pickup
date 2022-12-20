import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { GenericContainer as Container } from 'testcontainers'
import { nanoid } from 'nanoid'
import test from 'ava'
import nock from 'nock'

import { addPin } from '../basic/add-pin-router.js'

import responseGetPinUnpinned from './__data/response-get-pin-unpinned.js'
import responseGetPinPinned from './__data/response-get-pin-pinned.js'
import responseGetPinQueued from './__data/response-get-pin-queued.js'
import responseAddPin from './__data/response-add-pin.js'
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'

test.before(async t => {
  t.timeout(1000 * 60)

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

  t.context.legacyClusterIpfsUrl = 'http://legacy-cluster.loc'
  t.context.pickupUrl = 'http://pickup.loc'
})

test('addPin with CID not in the system and fallback on pickup', async t => {
  const { dynamo, table } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']
  const token = 'abcdfefg'

  const nockLegacyClusterIpfs = nock(t.context.legacyClusterIpfsUrl)
  nockLegacyClusterIpfs
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinUnpinned)

  const nockPickup = nock(t.context.pickupUrl)
  nockPickup
    .post(`/internal/pins/${cid}`)
    .query({ origins: origins.join(',') })
    .reply(200, { ...responseAddPin, cid, origins, timestamp: '123123123' })

  const res = await addPin({
    cid,
    origins,
    dynamo,
    table,
    legacyClusterIpfsUrl: t.context.legacyClusterIpfsUrl + '/api',
    pickupUrl: t.context.pickupUrl,
    token,
    balancerRate: 100
  })

  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.deepEqual(res.body.origins, origins)
  t.is(res.body.type, 'pin')

  nockLegacyClusterIpfs.done()
  nockPickup.done()
})

test('addPin with CID not in the system and fallback on pickup withoput origins', async t => {
  const { dynamo, table } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = []
  const token = 'abcdfefg'

  const nockLegacyClusterIpfs = nock(t.context.legacyClusterIpfsUrl)
  nockLegacyClusterIpfs
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinUnpinned)

  const nockPickup = nock(t.context.pickupUrl)
  nockPickup
    .post(`/internal/pins/${cid}`)
    .reply(200, { ...responseAddPin, cid, origins, timestamp: '123123123' })

  const res = await addPin({
    cid,
    origins,
    dynamo,
    table,
    legacyClusterIpfsUrl: t.context.legacyClusterIpfsUrl + '/api',
    pickupUrl: t.context.pickupUrl,
    token,
    balancerRate: 100
  })

  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.is(res.body.origins.length, 0)
  t.is(res.body.type, 'pin')

  nockLegacyClusterIpfs.done()
  nockPickup.done()
})

test('addPin with CID not in the system and fallback on legacy cluster', async t => {
  const { dynamo, table } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']
  const token = 'abcdfefg'

  const nockLegacyClusterIpfs = nock(t.context.legacyClusterIpfsUrl)
  nockLegacyClusterIpfs
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinUnpinned)
    .post(`/api/pins/${cid}`)
    .query({ origins: origins.join(',') })
    .reply(200, { ...responseAddPin, cid, origins, timestamp: '123123123' })

  const res = await addPin({
    cid,
    origins,
    dynamo,
    table,
    legacyClusterIpfsUrl: t.context.legacyClusterIpfsUrl + '/api',
    pickupUrl: t.context.pickupUrl,
    token,
    balancerRate: 0
  })

  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.deepEqual(res.body.origins, origins)
  t.is(res.body.type, 'pin')

  nockLegacyClusterIpfs.done()
})

test('addPin with CID not in the system and fallback on legacy cluster with empty origins', async t => {
  const { dynamo, table } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = []
  const token = 'abcdfefg'

  const nockLegacyClusterIpfs = nock(t.context.legacyClusterIpfsUrl)
  nockLegacyClusterIpfs
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinUnpinned)
    .post(`/api/pins/${cid}`)
    .reply(200, { ...responseAddPin, cid, origins, timestamp: '123123123' })

  const res = await addPin({
    cid,
    origins,
    dynamo,
    table,
    legacyClusterIpfsUrl: t.context.legacyClusterIpfsUrl + '/api',
    pickupUrl: t.context.pickupUrl,
    token,
    balancerRate: 0
  })

  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.is(res.body.origins.length, 0)
  t.is(res.body.type, 'pin')

  nockLegacyClusterIpfs.done()
})

test('addPin with CID existent in pickup', async t => {
  const { dynamo, table } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = []
  const token = 'abcdfefg'

  const client = DynamoDBDocumentClient.from(dynamo)
  const pin = {
    cid,
    status: 'queued',
    created: new Date().toISOString()
  }

  await client.send(new PutCommand({
    TableName: table,
    Item: pin,
    ConditionExpression: 'attribute_not_exists(cid)'
  }))

  const res = await addPin({
    cid,
    origins,
    dynamo,
    table,
    legacyClusterIpfsUrl: t.context.legacyClusterIpfsUrl + '/api',
    pickupUrl: t.context.pickupUrl,
    token,
    balancerRate: 0
  })

  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.is(res.body.origins.length, 0)
  t.is(res.body.type, 'pin')

  await client.send(new DeleteCommand({
    TableName: table,
    Key: { cid }
  }))
})

test('addPin with CID existent in l egacy cluster ipfs with pinned state', async t => {
  const { dynamo, table } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = []
  const token = 'abcdfefg'

  const nockLegacyClusterIpfs = nock(t.context.legacyClusterIpfsUrl)
  nockLegacyClusterIpfs
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinPinned)

  const res = await addPin({
    cid,
    origins,
    dynamo,
    table,
    legacyClusterIpfsUrl: t.context.legacyClusterIpfsUrl + '/api',
    pickupUrl: t.context.pickupUrl,
    token,
    balancerRate: 0
  })

  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.is(res.body.origins.length, 0)
  t.is(res.body.type, 'pin')

  nockLegacyClusterIpfs.done()
})

test('addPin with CID existent in l egacy cluster ipfs with queued state', async t => {
  const { dynamo, table } = t.context
  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = ['/p2p/12D3KooWCVU8Hjzky8u6earCs4z6m9SbznMn646Q9xt8QsvMXkgS']
  const token = 'abcdfefg'

  const nockLegacyClusterIpfs = nock(t.context.legacyClusterIpfsUrl)
  nockLegacyClusterIpfs
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinQueued)

  const res = await addPin({
    cid,
    origins,
    dynamo,
    table,
    legacyClusterIpfsUrl: t.context.legacyClusterIpfsUrl + '/api',
    pickupUrl: t.context.pickupUrl,
    token,
    balancerRate: 0
  })

  t.is(res.statusCode, 200)
  t.is(res.body.cid, cid)
  t.deepEqual(res.body.origins, origins)
  t.is(res.body.type, 'pin')

  nockLegacyClusterIpfs.done()
})
