import crypto from 'node:crypto'
import { compose } from 'node:stream'
import { CarBlockIterator } from '@ipld/car'
import { LinkIndexer } from 'linkdex'
import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { sha256 } from 'multiformats/hashes/sha2'

const CAR_CODEC = 0x0202

/**
 * @param {AsyncIterable<Uint8Array>} car
 */
export async function linkdex (car) {
  const blocksIterator = await CarBlockIterator.fromIterable(car)

  const linkIndexer = new LinkIndexer()

  for await (const block of blocksIterator) {
    linkIndexer.decodeAndIndex(block)
  }

  return linkIndexer.report()
}

/**
 * @param {import('node:crypto').Hash} hash
 */
export function createCarCid (hash) {
  const digest = Digest.create(sha256.code, hash.digest())
  return CID.createV1(CAR_CODEC, digest)
}

/**
 * Stream the bytes of a CAR to:
 * - find the total size in bytes
 * - calculate the CAR CID
 * - create a linkdex report to check the dag is complete
 *
 * @param {AsyncIterable<Uint8Array>} car
 */
export async function checkCar (car) {
  let carSize = 0
  const sha256 = crypto.createHash('sha256')
  const report = await linkdex(compose(car, async function * (source) {
    for await (const chunk of source) {
      sha256.update(chunk)
      carSize += chunk.byteLength
      yield chunk
    }
  }))
  const carCid = createCarCid(sha256)
  return { carCid: carCid.toString(), carSize, report }
}
