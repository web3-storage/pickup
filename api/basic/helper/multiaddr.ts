import isLocalIp from 'is-local-ip'
import { Multiaddr } from 'multiaddr'

export function isMultiaddr (input = ''): boolean {
  if (input === '' || input === null) return false
  try {
    new Multiaddr(input) // eslint-disable-line no-new
    return true
  } catch (e) {
    return false
  }
}

export function isNotPrivateIP (input = '') {
  if (input.startsWith('/ip6/') || input.startsWith('/ip4/')) {
    const ip = input.split('/').at(2)
    return !isLocalIp(ip)
  }
  return true
}