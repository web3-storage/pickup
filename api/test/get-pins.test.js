import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { GenericContainer as Container } from 'testcontainers'
import { nanoid } from 'nanoid'
import test from 'ava'

import { handler } from '../basic/get-pins.js'

import responseGetPins from './__data/response-get-pins.js'

const cids = [
  'QmdytmR4wULMd3SLo6ePF4s3WcRHWcpnJZ7bHhoj3QB13v',
  'QmSFxnK675wQ9Kc1uqWKyJUaNxvSc2BP5DbXCD3x93oq61',
  'QmdQEnYhrhgFKPCq5eKc7xb1k7rKyb3fGMitUPKvFAscVK',
  'QmR56UJmAaZLXLdTT1ALrE9vVqV8soUEekm9BMd4FnuYqV',
  'QmZa1tLVa8iEoDWbvwxV7rCxGnVGUff2jhF7a2DyCk5SbY'
]

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

  await dynamo.send(new PutCommand({
    TableName: table,
    Item: {
      cid: cids[0],
      status: 'queued',
      created: new Date().toISOString()
    }
  }))

  await dynamo.send(new PutCommand({
    TableName: table,
    Item: {
      cid: cids[4],
      status: 'pinned',
      created: new Date().toISOString()
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

test('get pins handler basic auth fail', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table

  const event = {
    headers: {
      authorization: 'nope'
    }
  }
  const response = await handler(event, t.context.lambdaContext)
  t.is(response.statusCode, 401)
  t.true(typeof response.body === 'string')
  t.deepEqual(JSON.parse(response.body), { error: { reason: 'UNAUTHORIZED' } })
})

test('get pins handler with no dynamo set', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = ''
  process.env.BATCH_ITEM_COUNT = 3

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    queryStringParameters: {
      cids: cids.join(',')
    }
  }

  const response = await handler(event, t.context.lambdaContext)

  t.is(response.statusCode, 500)
  t.deepEqual(response.body, '{"error":{"reason":"INTERNAL_SERVER_ERROR"}}')
})

test('get pins handler with no cids', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.BATCH_ITEM_COUNT = 3

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    queryStringParameters: {
      cids: ''
    }
  }

  const response = await handler(event, t.context.lambdaContext)

  t.deepEqual(response, {
    statusCode: 400,
    body: '{"error":{"reason":"BAD_REQUEST","details":"\\"cids\\" parameter not found"}}'
  })
})

test('get pins handler with non valid cids', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.BATCH_ITEM_COUNT = 3

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    queryStringParameters: {
      cids: [...cids, '123', '456'].join(',')
    }
  }

  const response = await handler(event, t.context.lambdaContext)

  t.deepEqual(response, {
    statusCode: 400,
    body: '{"error":{"reason":"BAD_REQUEST","details":"123 is not a valid CID, 456 is not a valid CID"}}'
  })
})

test('get pins handler with non string cids', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.BATCH_ITEM_COUNT = 3

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    queryStringParameters: {
      cids
    }
  }

  const response = await handler(event, t.context.lambdaContext)

  t.deepEqual(response, {
    statusCode: 400,
    body: '{"error":{"reason":"BAD_REQUEST","details":"\\"cids\\" parameter should be a comma separated string"}}'
  })
})

test('get pins handler basic auth success', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.DYNAMO_DB_ENDPOINT = t.context.dbEndpoint
  process.env.TABLE_NAME = t.context.table
  process.env.BATCH_ITEM_COUNT = 3

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    queryStringParameters: {
      cids: cids.join(',')
    }
  }

  const response = await handler(event, t.context.lambdaContext)

  t.is(response.statusCode, 200)

  const expectedResults = responseGetPins.split('\n').map(row => JSON.parse(row))
  const responseRows = JSON.parse(response.body).split('\n').map(row => JSON.parse(row))

  t.is(responseRows.length, 5)
  responseRows.forEach((result, i) => {
    t.truthy(result.cid)
    t.truthy(Object.values(result.peer_map)[0].status)

    t.is(result.cid, expectedResults[i].cid)
    t.is(
      Object.values(result.peer_map)[0].status,
      Object.values(expectedResults[i].peer_map)[0].status
    )
  })
})
