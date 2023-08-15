import crypto from 'node:crypto'
import { concat } from 'node:stream'
import { CarBlockIterator } from '@ipld/car'
import { LinkIndexer } from 'linkdex'
import * as Link from 'multiformats/link'
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
 * A pass through stream that updates the hash digest
 * @param {import('node:crypto').Hash} hash
 */
export function createHashStream (hash) {
  return async function * passThruHash (source) {
    for await (const chunk of source) {
      hash.update(chunk)
      yield chunk
    }
  }
}

/**
 * @param {import('node:crypto').Hash} hash
 */
export function createCarCid (hash) {
  const digest = Digest.create(sha256.code, hash.digest())
  return Link.create(CAR_CODEC, digest)
}

/**
 * Stream a car through linkdex to check if it's complete, and create the carCid
 *
 * @param {AsyncIterable<Uint8Array>} car
 */
export async function checkCar (car) {
  const sha256 = crypto.createHash('sha256')
  const report = await linkdex(concat(car, createHashStream(sha256)))
  const carCid = createCarCid(sha256)
  return { carCid, report }
}
