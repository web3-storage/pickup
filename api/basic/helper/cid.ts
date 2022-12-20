import { CID } from 'multiformats/cid'
import { Multiaddr } from 'multiaddr'

export function isCID (str = ''): boolean {
  try {
    return Boolean(CID.parse(str))
  } catch (err) {
    return false
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
