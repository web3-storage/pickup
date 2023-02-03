import { compose } from 'node:stream'
import { CID } from 'multiformats/cid'
import { Multiaddr } from 'multiaddr'
import debounce from 'debounce'
import fetch from 'node-fetch'

import { logger } from './logger.js'

export const ERROR_TIMEOUT = 'TIMEOUT'

/**
 * Start the fetch of a car
 *
 * @param string cid - The CID requested
 * @param string ipfsApiUrl - The IPFS server url
 * @param object downloadError - The error object, is filled in if an error occour
 * @param int timeoutMs - The timeout for each block fetch in milliseconds.
 *                        The Download is set to `failed` if the IPFS server
 *                        fetch action do not respond while is downloading the blocks.
 * @returns {Promise<*>}
 */
export async function fetchCar (cid, ipfsApiUrl, downloadError, timeoutMs = 30000) {
  if (!isCID(cid)) {
    throw new Error({ message: `Invalid CID: ${cid}` })
  }
  const url = new URL(`/api/v0/dag/export?arg=${cid}`, ipfsApiUrl)
  const ctl = new AbortController()

  const startCountdown = debounce(() => {
    downloadError.code = ERROR_TIMEOUT
    ctl.abort()
  }, timeoutMs)
  startCountdown()
  const res = await fetch(url, { method: 'POST', signal: ctl.signal })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} ${url}`)
  }

  async function * restartCountdown (source) {
    // startCountdown.clear()
    // throw new Error('There was an error!!')
    for await (const chunk of source) {
      startCountdown()
      yield chunk
    }
    startCountdown.clear()
  }

  return compose(res.body, restartCountdown)
}

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

export async function waitForGC (ipfsApiUrl, timeoutMs = 60000) {
  const url = new URL('/api/v0/repo/gc?silent=true', ipfsApiUrl)
  const signal = AbortSignal.timeout(timeoutMs)
  const res = await fetch(url, { method: 'POST', signal })
  if (!res.ok) {
    logger.error({ url, status: res.status, statusText: res.statusText }, 'Error GC')
  }
  await res.text()
}

export function isMultiaddr (input) {
  if (!input) return false
  try {
    new Multiaddr(input) // eslint-disable-line no-new
    return true
  } catch (e) {
    return false
  }
}

export function isCID (str) {
  return Boolean(CID.parse(str))
}

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
    const { AgentVersion, ID } = await res.json()
    logger.info({ agentVersion: AgentVersion, peerId: ID }, 'Connected')
  } catch (err) {
    logger.error({ err }, 'Test ipfs fail')
    throw new Error('IPFS API test failed.', { cause: err })
  }
}

export async function repoStat (ipfsApiUrl) {
  const res = await fetch(new URL('/api/v0/repo/stat', ipfsApiUrl), { method: 'POST' })
  if (res.ok) {
    return res.json()
  }
}
