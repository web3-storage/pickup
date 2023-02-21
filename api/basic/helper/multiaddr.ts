import bogon from 'bogon'
import { Multiaddr } from 'multiaddr'

/**
 * Convert a comma-separated list of origins into an array of
 * multiaddr strings that we could possibly connect to.
 *
 * Filters out:
 * - malformed multiaddrs and ones with transports we don't recognise
 * - private or reserved ip address that we wouldn't be able to connect to.
 */
export function findUsableMultiaddrs (input = ''): string[] {
  if (input === '' || input === null) return []
  return input
    .split(',')
    .filter(isMultiaddr)
    .filter(hasPublicIpAddress)
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
