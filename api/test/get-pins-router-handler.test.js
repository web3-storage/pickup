import test from 'ava'
import nock from 'nock'

import { handler } from '../basic/get-pins-router.js'

import responseGetPins from './__data/response-get-pins.js'
import responseGetPinsLegacy from './__data/response-get-pins-legacy.js'

const cids = [
  'QmdytmR4wULMd3SLo6ePF4s3WcRHWcpnJZ7bHhoj3QB13v',
  'QmSFxnK675wQ9Kc1uqWKyJUaNxvSc2BP5DbXCD3x93oq61',
  'QmdQEnYhrhgFKPCq5eKc7xb1k7rKyb3fGMitUPKvFAscVK',
  'QmR56UJmAaZLXLdTT1ALrE9vVqV8soUEekm9BMd4FnuYqV',
  'QmZa1tLVa8iEoDWbvwxV7rCxGnVGUff2jhF7a2DyCk5SbY'
]

/*
  curl -X GET 'https://web3.storage.ipfscluster.io/api/pins?cids=QmdytmR4wULMd3SLo6ePF4s3WcRHWcpnJZ7bHhoj3QB13v' -H "Authorization: Basic c3RvcmFnZS1ib3Q6RnVVdjJEcFMyRGNUZXlaYg==" -s | jq
 */
test.before(async t => {
  process.env.LOG_LEVEL = 'silent'

  t.context.legacyClusterIpfsUrl = 'http://legacy-cluster.loc'
  t.context.pickupUrl = 'http://pickup.loc'

  t.context.lambdaContext = {
    awsRequestId: 123123
  }
})

test('get pins router handler basic auth fail', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'

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

test('get pins router handler without cids', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsUrl + '/api'
  process.env.PICKUP_URL = t.context.pickupUrl

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

test('get pins router handler with invalid cid', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsUrl + '/api'
  process.env.PICKUP_URL = t.context.pickupUrl

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

test('get pins router handler with invalid pickupUrl', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsUrl + '/api'
  process.env.PICKUP_URL = ''

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
    statusCode: 500,
    body: '{"error":{"reason":"INTERNAL_SERVER_ERROR"}}'
  })
})

test('get pins router handler with invalid legacyClusterIpfsUrl', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = ''
  process.env.PICKUP_URL = t.context.pickupUrl

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
    statusCode: 500,
    body: '{"error":{"reason":"INTERNAL_SERVER_ERROR"}}'
  })
})

test('get pins router handler with result from pickup and legacy', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsUrl + '/api'
  process.env.PICKUP_URL = t.context.pickupUrl

  const nockPickup = nock(t.context.pickupUrl)
  nockPickup
    .get(`/internal/pins?cids=${cids.join(',')}`)
    .reply(200, responseGetPins + '\n')

  const nockLegacyClusterIpfs = nock(t.context.legacyClusterIpfsUrl)
  nockLegacyClusterIpfs
    .get(`/api/pins?cids=${cids[1]},${cids[2]},${cids[3]}`)
    .reply(200, responseGetPinsLegacy + '\n')

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

  const expectedResultsPickup = responseGetPins.split('\n').map(row => JSON.parse(row))
  const expectedResultsLegacy = responseGetPinsLegacy.split('\n').map(row => JSON.parse(row))

  const checkValues = JSON.parse(response.body).split('\n').map(row => JSON.parse(row))

  function checkEntry (result, expected) {
    t.truthy(result.cid)
    t.truthy(Object.values(result.peer_map)[0].status)
    t.is(result.cid, expected.cid)
    t.is(
      Object.values(result.peer_map)[0].status,
      Object.values(expected.peer_map)[0].status
    )
  }

  checkEntry(checkValues[0], expectedResultsPickup[0])
  checkEntry(checkValues[1], expectedResultsLegacy[0])
  checkEntry(checkValues[2], expectedResultsLegacy[1])
  checkEntry(checkValues[3], expectedResultsLegacy[2])
  checkEntry(checkValues[4], expectedResultsPickup[4])

  nockPickup.done()
  nockLegacyClusterIpfs.done()
})

test('get pins router handler with result only from pickup', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsUrl + '/api'
  process.env.PICKUP_URL = t.context.pickupUrl

  const expectedResultsPickup = responseGetPins.split('\n')
  const nockPickup = nock(t.context.pickupUrl)
  nockPickup
    .get(`/internal/pins?cids=${cids[0]},${cids[4]}`)
    .reply(200, expectedResultsPickup[0] + '\n' + expectedResultsPickup[4])

  const event = {
    headers: {
      authorization: `Basic ${process.env.CLUSTER_BASIC_AUTH_TOKEN}`
    },
    queryStringParameters: {
      cids: [cids[0], cids[4]].join(',')
    }
  }
  const response = await handler(event, t.context.lambdaContext)

  t.is(response.statusCode, 200)

  const checkValues = JSON.parse(response.body).split('\n')

  t.is(checkValues[0].cid, expectedResultsPickup[0].cid)
  t.is(checkValues[0].status, expectedResultsPickup[0].status)

  t.is(checkValues[1].cid, expectedResultsPickup[4].cid)
  t.is(checkValues[1].status, expectedResultsPickup[4].status)

  nockPickup.done()
})
