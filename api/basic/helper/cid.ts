import { CID } from 'multiformats/cid'
import { base58btc } from 'multiformats/bases/base58'

export function isCID (str = ''): boolean {
  try {
    // multibase cid v0 starts with 'z'
    if (str[0] === 'z') {
      return isCidV0(str)
    }
    return Boolean(CID.parse(str))
  } catch (err) {
    return false
  }
}

export function sanitizeCid (cid: string): string {
  if (cid[0] === 'z' && isCidV0(cid)) {
    cid = cid.substring(1)
  }
  return cid
}

function isCidV0 (cid: string): boolean {
  try {
    const c = CID.parse(cid, base58btc)
    return c.version === 0
  } catch {
    return false
  }
}
