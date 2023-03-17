import { compose } from 'node:stream'
import { CID } from 'multiformats/cid'
import { Multiaddr } from 'multiaddr'
import debounce from 'debounce'
import fetch from 'node-fetch'
import retry from 'p-retry'
import { logger } from './logger.js'

/** @typedef {import('node:stream').Readable} Readable */

/**
 * Fetch a CAR from kubo
 *
 * @param {string} cid - The CID requested
 * @param {string} ipfsApiUrl - The IPFS server url
 * @param {AbortSignal} signal - Cancel the fetch
 * @returns {Promise<Readable>}
 */
export async function fetchCar ({ cid, ipfsApiUrl, signal }) {
  if (!isCID(cid)) {
    throw new Error({ message: `Invalid CID: ${cid}` })
  }
  const url = new URL(`/api/v0/dag/export?arg=${cid}`, ipfsApiUrl)

  const res = await fetch(url, { method: 'POST', signal })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} ${url}`)
  }
  return res.body
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

export const TOO_BIG = 'TOO_BIG'
export const FETCH_TOO_SLOW = 'FETCH_TOO_SLOW'
export const CHUNK_TOO_SLOW = 'CHUNK_TOO_SLOW'

export class CarFetcher {
  /**
   * @param {object} config
   * @param {string} config.ipfsApiUrl
   * @param {number} config.maxCarBytes
   * @param {number} config.fetchTimeoutMs
   * @param {number} config.fetchChunkTimeoutMs
   */
  constructor ({
    ipfsApiUrl = 'http://127.0.0.1:5001',
    maxCarBytes = 31 * (1024 ** 3), /* 31 GiB */
    fetchTimeoutMs = 4 * 60 * 60 * 1000, /* 4 hrs */
    fetchChunkTimeoutMs = 2 * 60 * 1000 /* 2 mins */
  }) {
    this.ipfsApiUrl = ipfsApiUrl
    this.maxCarBytes = maxCarBytes
    this.fetchTimeoutMs = fetchTimeoutMs
    this.fetchChunkTimeoutMs = fetchChunkTimeoutMs
  }

  /**
   * @param {object} config
   * @param {string} config.cid
   * @param {AbortController} config.abortCtl
   */
  async fetch ({ cid, abortCtl }) {
    const { ipfsApiUrl, maxCarBytes, fetchTimeoutMs, fetchChunkTimeoutMs } = this
    /**
     * @param {AsyncIterable<Uint8Array>} source
     */
    async function * streamWatcher (source) {
      const fetchTimer = debounce(() => abort(FETCH_TOO_SLOW), fetchTimeoutMs)
      const chunkTimer = debounce(() => abort(CHUNK_TOO_SLOW), fetchChunkTimeoutMs)
      const clearTimers = () => {
        fetchTimer.clear()
        chunkTimer.clear()
      }
      function abort (reason) {
        clearTimers()
        if (!abortCtl.signal.aborted) {
          abortCtl.abort(reason)
        }
      }
      fetchTimer()
      chunkTimer()
      let size = 0
      for await (const chonk of source) {
        chunkTimer()
        size += chonk.byteLength
        if (size > maxCarBytes) {
          abort(TOO_BIG)
          throw new Error(TOO_BIG) // kill the stream now so we dont send more bytes
        } else {
          yield chonk
        }
      }
      clearTimers()
    }

    const body = await fetchCar({ cid, ipfsApiUrl, signal: abortCtl.signal })
    return compose(body, streamWatcher)
  }

  async testIpfsApi () {
    return retry(() => testIpfsApi(this.ipfsApiUrl), { retries: 5 })
  }

  /**
   * @param {string[]} origins
   */
  async connectTo (origins) {
    return connectTo(origins, this.ipfsApiUrl)
  }

  /**
   * @param {string[]} origins
   */
  async disconnect (origins) {
    return disconnect(origins, this.ipfsApiUrl)
  }

  async waitForGc () {
    return waitForGC(this.ipfsApiUrl)
  }
}
