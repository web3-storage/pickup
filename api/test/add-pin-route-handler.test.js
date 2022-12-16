import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { GenericContainer as Container } from 'testcontainers'
import { nanoid } from 'nanoid'
import test from 'ava'
import nock from 'nock'

import { handler } from '../basic/add-pin-route.js'

import responseGetPinUnpinned from './__data/response-get-pin-unpinned.js'
import responseAddPin from './__data/response-add-pin.js'

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

  t.context.indexerEndpoint = 'http://indexer.loc'
  t.context.pickupEndpoint = 'http://pickup.loc'
})

test('add pin route handler basic auth fail', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table

  const event = {
    headers: {
      authorization: 'nope'
    },
    pathParameters: {
      cid: 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'
    }
  }
  const response = await handler(event)
  t.is(response.statusCode, 401)
  t.true(typeof response.body === 'string')
  t.deepEqual(JSON.parse(response.body), { error: { reason: 'UNAUTHORIZED' } })
})

test('add pin route handler basic auth success', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.INDEXER_ENDPOINT = t.context.indexerEndpoint
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint
  process.env.BALANCER_RATE = 100

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'

  const nockIndexer = nock(t.context.indexerEndpoint)
  nockIndexer
    .get(`/pins/${cid}`)
    .reply(200, responseGetPinUnpinned)

  const nockPickup = nock(t.context.pickupEndpoint)
  nockPickup
    .post(`/internal/pins/${cid}`)
    .reply(200, { ...responseAddPin, cid, origins: [], timestamp: '123123123' })

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    pathParameters: {
      cid
    }
  }
  const response = await handler(event)
  t.is(response.statusCode, 200)

  nockIndexer.done()
  nockPickup.done()
})

test('add pin route handler without table', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = ''
  process.env.INDEXER_ENDPOINT = t.context.indexerEndpoint
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint
  process.env.BALANCER_RATE = 100

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    pathParameters: {
      cid
    }
  }
  const response = await handler(event)

  t.deepEqual(response, {
    statusCode: 500,
    body: '{"error":{"reason":"INTERNAL_SERVER_ERROR","details":"TABLE must be set in ENV"}}'
  })
})

test('add pin route handler without cid', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.INDEXER_ENDPOINT = t.context.indexerEndpoint
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint
  process.env.BALANCER_RATE = 100

  const cid = ''

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    pathParameters: {
      cid
    }
  }
  const response = await handler(event)

  t.deepEqual(response, {
    statusCode: 400,
    body: '{"error":{"reason":"BAD_REQUEST","details":"CID not found in path"}}'
  })
})

test('add pin route handler with invalid cid', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.INDEXER_ENDPOINT = t.context.indexerEndpoint
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint
  process.env.BALANCER_RATE = 100

  const cid = '123123123'

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    pathParameters: {
      cid
    }
  }
  const response = await handler(event)

  t.deepEqual(response, {
    statusCode: 400,
    body: '{"error":{"reason":"BAD_REQUEST","details":"123123123 is not a valid CID"}}'
  })
})

test('add pin route handler with invalid multiaddress', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.INDEXER_ENDPOINT = t.context.indexerEndpoint
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint
  process.env.BALANCER_RATE = 100

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const origins = 'abc'
  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    pathParameters: {
      cid
    },
    queryStringParameters: { origins }
  }
  const response = await handler(event)

  t.deepEqual(response, {
    statusCode: 400,
    body: '{"error":{"reason":"BAD_REQUEST","details":"abc in origins is not a valid multiaddr"}}'
  })
})

test('add pin route handler with invalid indexerEndpoint', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.INDEXER_ENDPOINT = t.context.indexerEndpoint
  process.env.PICKUP_ENDPOINT = ''
  process.env.BALANCER_RATE = 100

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    pathParameters: {
      cid
    }
  }
  const response = await handler(event)

  t.deepEqual(response, {
    statusCode: 500,
    body: '{"error":{"reason":"INTERNAL_SERVER_ERROR","details":"PICKUP_ENDPOINT not defined"}}'
  })
})

test('add pin route handler with invalid pickupEndpoint', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.INDEXER_ENDPOINT = ''
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint
  process.env.BALANCER_RATE = 100

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    pathParameters: {
      cid
    }
  }
  const response = await handler(event)

  t.deepEqual(response, {
    statusCode: 500,
    body: '{"error":{"reason":"INTERNAL_SERVER_ERROR","details":"INDEXER_ENDPOINT not defined"}}'
  })
})
