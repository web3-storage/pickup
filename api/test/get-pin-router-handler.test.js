import test from 'ava'
import nock from 'nock'

import { handler } from '../basic/get-pin-router.js'

import responseGetPinUnpinned from './__data/response-get-pin-unpinned.js'
import responseGetPinPinned from './__data/response-get-pin-pinned.js'
import responseGetPinQueued from './__data/response-get-pin-queued.js'

test.before(async t => {
  t.context.legacyClusterIpfsEndpoint = 'http://indexer.loc'
  t.context.pickupEndpoint = 'http://pickup.loc'
})

test('get pin router handler basic auth fail', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'

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

test('get pin router handler without cid', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsEndpoint + '/api'
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint

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

test('get pin router handler with invalid cid', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsEndpoint + '/api'
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint

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

test('get pin router handler with invalid pickupEndpoint', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsEndpoint + '/api'
  process.env.PICKUP_ENDPOINT = ''

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

test('get pin router handler with invalid legacyClusterIpfsEndpoint', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = ''
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint

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
    body: '{"error":{"reason":"INTERNAL_SERVER_ERROR","details":"LEGACY_CLUSTER_IPFS_URL not defined"}}'
  })
})

test('get pin router handler with result from pickup', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsEndpoint + '/api'
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'

  const nockPickup = nock(t.context.pickupEndpoint)
  nockPickup
    .get(`/internal/pins/${cid}`)
    .reply(200, responseGetPinPinned)

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

  nockPickup.done()
})

test('get pin router handler with non valid result from pickup', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsEndpoint + '/api'
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'

  const nockIndexer = nock(t.context.legacyClusterIpfsEndpoint)
  nockIndexer
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinPinned)

  const nockPickup = nock(t.context.pickupEndpoint)
  nockPickup
    .get(`/internal/pins/${cid}`)
    .reply(500, responseGetPinQueued)

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
  t.is(response.body, JSON.stringify(responseGetPinPinned))

  nockPickup.done()
  nockIndexer.done()
})

test('get pin router handler with unpinned result from pickup', async t => {
  process.env.CLUSTER_BASIC_AUTH_TOKEN = 'YES'
  process.env.LEGACY_CLUSTER_IPFS_URL = t.context.legacyClusterIpfsEndpoint + '/api'
  process.env.PICKUP_ENDPOINT = t.context.pickupEndpoint

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'

  const nockIndexer = nock(t.context.legacyClusterIpfsEndpoint)
  nockIndexer
    .get(`/api/pins/${cid}`)
    .reply(200, responseGetPinPinned)

  const nockPickup = nock(t.context.pickupEndpoint)
  nockPickup
    .get(`/internal/pins/${cid}`)
    .reply(200, responseGetPinUnpinned)

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
  t.is(response.body, JSON.stringify(responseGetPinPinned))

  nockPickup.done()
  nockIndexer.done()
})
