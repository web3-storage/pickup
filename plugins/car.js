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

export async function connectTo (origins, gateway) {
  // best effort
  for (const addr of origins.filter(isMultiaddr)) {
    // TODO: what about  /api/v0/swarm/peering/add ? is better? Should we disconnect also?
    const url = new URL(`/api/v0/swarm/connect?arg=${addr}`, gateway)
    fetch(url, { method: 'POST' })
  }
}

export async function disconnect (origins, gateway) {
  // best effort
  for (const addr of origins.filter(isMultiaddr)) {
    // TODO: what about  /api/v0/swarm/peering/add ? is better? Should we disconnect also?
    const url = new URL(`/api/v0/swarm/disconnect?arg=${addr}`, gateway)
    fetch(url, { method: 'POST' })
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
