import { CID } from 'multiformats/cid'
import { Multiaddr } from 'multiaddr'

export function isCID (str = ''): boolean {
  try {
    if (str[0] === 'z' && isCidV0(str.substring(1))) {
      return true
    }
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

export function sanitizeCid (cid: string): string {
  if (cid[0] === 'z' && isCidV0(cid.substring(1))) {
    cid = cid.substring(1)
  }
  return cid
}

function isCidV0 (cid: string): boolean {
  const c = CID.parse(cid.substring(1))
  return c.version === 0
}

// TODO test
