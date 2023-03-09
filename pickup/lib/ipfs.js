import { compose } from 'node:stream'
import { CID } from 'multiformats/cid'
import { Multiaddr } from 'multiaddr'
import debounce from 'debounce'
import fetch from 'node-fetch'
import retry from 'p-retry'
import { logger } from './logger.js'

export const ERROR_TIMEOUT = 'TIMEOUT'

/** @typedef {import('node:stream').Readable} Readable */

/**
 * Start the fetch of a car
 *
 * @param {string} cid - The CID requested
 * @param {string} ipfsApiUrl - The IPFS server url
 * @param {AbortController} abortCtl - Can i kill it?
 * @param {number} timeoutMs - The timeout for each block fetch in milliseconds.
 * @returns {Promise<Readable>}
 */
export async function fetchCar ({ cid, ipfsApiUrl, abortCtl = new AbortController(), timeoutMs = 30000 }) {
  if (!isCID(cid)) {
    throw new Error({ message: `Invalid CID: ${cid}` })
  }
  const url = new URL(`/api/v0/dag/export?arg=${cid}`, ipfsApiUrl)

  const startCountdown = debounce(() => abortCtl.abort(), timeoutMs)
  startCountdown()

  const signal = abortCtl.signal
  const res = await fetch(url, { method: 'POST', signal })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} ${url}`)
  }

  async function * restartCountdown (source) {
    for await (const chunk of source) {
      startCountdown()
      yield chunk
    }
    startCountdown.clear()
  }

  return compose(res.body, restartCountdown)
}

/**
 * Add origins to the IPFS server
 * @param {string[]} origins
 * @param {string} ipfsApiUrl
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
export async function connectTo (origins = [], ipfsApiUrl, timeoutMs = 10000) {
  for (const addr of origins.filter(isMultiaddr)) {
    const url = new URL(`/api/v0/swarm/connect?arg=${addr}`, ipfsApiUrl)
    const signal = AbortSignal.timeout(timeoutMs)
    const res = await fetch(url, { method: 'POST', signal })
    if (!res.ok) {
      logger.error({ addr, status: res.status, statusText: res.statusText }, 'Error connecting')
    }
  }
}

/**
 * Remove origins from IPFS server
 * @param {string[]} origins
 * @param {string} ipfsApiUrl
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
export async function disconnect (origins = [], ipfsApiUrl, timeoutMs = 10000) {
  for (const addr of origins.filter(isMultiaddr)) {
    const url = new URL(`/api/v0/swarm/disconnect?arg=${addr}`, ipfsApiUrl)
    const signal = AbortSignal.timeout(timeoutMs)
    const res = await fetch(url, { method: 'POST', signal })
    if (!res.ok) {
      logger.error({ addr, status: res.status, statusText: res.statusText }, 'Error disconnecting')
    }
  }
}

/**
 * Run the GC on IPFS server
 *
 * @param {string} ipfsApiUrl
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
export async function waitForGC (ipfsApiUrl, timeoutMs = 60000) {
  const url = new URL('/api/v0/repo/gc?silent=true', ipfsApiUrl)
  const signal = AbortSignal.timeout(timeoutMs)
  const res = await fetch(url, { method: 'POST', signal })
  if (!res.ok) {
    logger.error({ url, status: res.status, statusText: res.statusText }, 'Error GC')
  }
  await res.text()
}

/**
 * Verify if the value is a valid multiaddress
 * @param input
 * @returns {boolean}
 */
export function isMultiaddr (input) {
  if (!input) return false
  try {
    new Multiaddr(input) // eslint-disable-line no-new
    return true
  } catch (e) {
    return false
  }
}

/**
 * Verify if the value is a CID
 *
 * @param {string} cid
 * @returns {boolean}
 */
export function isCID (cid) {
  return Boolean(CID.parse(cid))
}

/**
 * Test the connection with IPFS server
 * @param {string} ipfsApiUrl
 * @param {number} timeoutMs
 * @returns {Promise<Record<string, string>>}
 */
export async function testIpfsApi (ipfsApiUrl, timeoutMs = 10000) {
  const url = new URL('/api/v0/id', ipfsApiUrl)
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const res = await fetch(url, { method: 'POST', signal })
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('IPFS API returned 404. IPFS_API_URL must be the RPC API port (:5001) rather than the ipfsApiUrl port (:8080)')
      }
      throw new Error(`IPFS API test failed. POST ${url} returned ${res.status} ${res.statusText}`)
    }
    return await res.json()
  } catch (err) {
    throw new Error('IPFS API test failed.', { cause: err })
  }
}

export class CarFetcher {
  /**
   * @param {object} config
   * @param {string} config.ipfsApiUrl
   * @param {number} config.fetchTimeoutMs
   */
  constructor ({ ipfsApiUrl, fetchTimeoutMs = 60000 }) {
    this.ipfsApiUrl = ipfsApiUrl
    this.fetchTimeoutMs = fetchTimeoutMs
  }

  /**
   * @param {object} config
   * @param {string} config.cid
   * @param {string[]} config.origins
   * @param {(body: Readable) => Promise<void>} config.upload
   */
  async fetch ({ cid, origins, upload }) {
    const { ipfsApiUrl, fetchTimeoutMs } = this
    try {
      await connectTo(origins, ipfsApiUrl)
      const body = await fetchCar({ cid, ipfsApiUrl, timeoutMs: fetchTimeoutMs })
      await upload(body)
    } finally {
      await disconnect(origins, ipfsApiUrl)
      await waitForGC(ipfsApiUrl)
    }
  }

  async testIpfsApi () {
    return retry(() => testIpfsApi(this.ipfsApiUrl), { retries: 4 })
  }
}
