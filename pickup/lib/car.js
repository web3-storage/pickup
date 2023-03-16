import { CarBlockIterator } from '@ipld/car'
import { LinkIndexer } from 'linkdex'

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
