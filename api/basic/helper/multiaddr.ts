import bogon from 'bogon'
import { Multiaddr } from 'multiaddr'

/**
 * Convert a comma-separated list of origins into an array of
 * multiaddr strings that we could possibly connect to.
 *
 * Picks the first 10 non-ip based multiaddr,
 * or ip based multiaddrs with a public (non-bogon) IP address
 * or a /p2p/:peerId addr from a bogon ip based multiaddr.
 **/
export function findUsableMultiaddrs (input = ''): string[] {
  if (input === '' || input === null) return []
  const specificAddrs: Set<string> = new Set()
  const p2pAddrs: Set<string> = new Set()
  for (const str of input.split(',')) {
    const input = str.trim()
    const ma = asMultiaddr(input)
    if (ma === undefined) continue
    // where we've got a ma with an ip we can't connect to,
    // try to extract the /p2p/:peerId addr where available
    if (hasBogonIpAddress(input)) {
      const addr = getP2pAddr(input)
      if (addr !== undefined) {
        p2pAddrs.add(addr)
      }
    } else {
      // either an ip based multiaddr with public ip, or a non-ip based multiaddr
      specificAddrs.add(input)
    }
  }
  return Array
    .from(specificAddrs)
    .concat(Array.from(p2pAddrs))
    .slice(1, 10) // don't return an unbounded number of multiaddrs.
}

export function asMultiaddr (input = ''): Multiaddr | undefined {
  if (input === '' || input === null) return undefined
  try {
    return new Multiaddr(input) // eslint-disable-line no-new
  } catch (e) {
    return undefined
  }
}

export function isMultiaddr (input = ''): boolean {
  if (input === '' || input === null) return false
  try {
    new Multiaddr(input) // eslint-disable-line no-new
    return true
  } catch (e) {
    return false
  }
}

export function hasPublicIpAddress (input = ''): boolean {
  if (input === '' || input === null) return false
  if (input.startsWith('/ip6/') || input.startsWith('/ip4/')) {
    const ip = input.split('/').at(2)
    if (ip === undefined) return false
    return !bogon(ip)
  }
  // not a IP based multiaddr, so we allow it.
  return true
}

export function hasBogonIpAddress (input = ''): boolean {
  if (input === '' || input === null) return false
  if (input.startsWith('/ip6/') || input.startsWith('/ip4/')) {
    const ip = input.split('/').at(2)
    if (ip === undefined) return false
    return bogon(ip)
  }
  return false
}

export function getP2pAddr (input = ''): string | undefined {
  if (input === '' || input === null) return undefined
  const match = input.match(/\/p2p\/\w+$/)
  if (match != null) {
    return match.at(0)
  }
}
