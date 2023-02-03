import { CID } from 'multiformats/cid'
import { bytes } from 'multiformats'
import { sha256, sha512 } from 'multiformats/hashes/sha2'
import { CarReader } from '@ipld/car'
import { recursive } from 'ipfs-unixfs-exporter'

const { toHex } = bytes

const hashes = {
  [sha256.code]: sha256,
  [sha512.code]: sha512
}

export function parseCid (cid) {
  let errors = []
  let info
  try {
    info = CID.parse(cid)
  } catch (err) {
    errors = [{ cid, detail: 'Unable to parse cid', err }]
  }

  return { info, errors }
}

export async function parseCar ({ cid, carStream }) {
  const errors = []

  let carReader
  try {
    carReader = await CarReader.fromIterable(carStream)
  } catch (err) {
    const error = { cid: cid.toString(), detail: err.message }
    errors.push(error)
    return { errors }
  }

  const verifyingBlockService = {
    get: async (cid) => {
      const block = await carReader.get(cid)
      if (!block.cid || !block.bytes) {
        const error = { cid: cid.toString(), detail: 'Unable to retrieve block' }
        errors.push(error)
        return error
      }
      const valid = validateBlock(block)
      if (valid.error) {
        errors.push(valid.error)
        return valid.error
      }
      return block.bytes
    }
  }

  await recursive(cid, verifyingBlockService, {})

  return { errors }
}

async function validateBlock ({ cid, bytes }) {
  const hashfn = hashes[cid.multihash.code]
  if (!hashfn) {
    return { error: { cid: cid.toString(), detail: `Missing hash function for ${cid.multihash.code}` } }
  }

  let hash
  try {
    hash = await hashfn.digest(bytes)
  } catch (err) {
    return { error: { cid: cid.toString(), detail: `Unable to hash ${cid} bytes`, err } }
  }

  if (toHex(hash.digest) !== toHex(cid.multihash.digest)) {
    return { error: { cid: cid.toString(), detail: 'Bad block. Hash does not match CID' } }
  }

  return { error: null }
}
