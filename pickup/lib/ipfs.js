import { CID } from 'multiformats/cid'
import { Multiaddr } from 'multiaddr'
import fetch from 'node-fetch'

export async function fetchCar (cid, gateway) {
  if (!isCID(cid)) {
    throw new Error({ message: `Invalid CID: ${cid}` })
  }
  const url = new URL(`/api/v0/dag/export?arg=${cid}`, gateway)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} ${url}`)
  }
  return res.body
}

export async function connectTo (origins = [], gateway) {
  for (const addr of origins.filter(isMultiaddr)) {
    const url = new URL(`/api/v0/swarm/connect?arg=${addr}`, gateway)
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) {
      console.log(`Error connecting to ${addr} - got: ${res.status} ${res.statusText}`)
    }
  }
}

export async function disconnect (origins = [], gateway) {
  for (const addr of origins.filter(isMultiaddr)) {
    const url = new URL(`/api/v0/swarm/disconnect?arg=${addr}`, gateway)
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) {
      console.log(`Error disconnecting from ${addr} - got: ${res.status} ${res.statusText}`)
    }
  }
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

export async function testIpfsApi (ipfsApi) {
  const url = new URL('/api/v0/id', ipfsApi)
  try {
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('IPFS API returned 404. IPFS_API_URL must be the RPC API port (:5001) rather than the Gateway port (:8080)')
      }
      throw new Error(`IPFS API test failed. POST ${url} returned ${res.status} ${res.statusText}`)
    }
    const { AgentVersion, ID } = await res.json()
    console.log(`Connected to ${AgentVersion} peer: ${ID}`)
  } catch (cause) {
    throw new Error('IPFS API test failed.', { cause })
  }
}
