import { CID } from 'multiformats/cid'
import { CarBlockIterator } from '@ipld/car'
import { LinkIndexer } from 'linkdex'

import { logger } from './logger.js'

/**
 * Parse and validate the CID
 *
 * @param {string} cid
 * @returns {{errors: *[], info: CID<any, number, number, Version>}}
 */
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

export async function checkForCompleteDag (carBytes) {
  const blocksIterator = await CarBlockIterator.fromIterable(carBytes)

  const linkIndexer = new LinkIndexer()

  for await (const block of blocksIterator) {
    try {
      linkIndexer.decodeAndIndex(block)
    } catch (err) {
      logger.error({ err }, 'Block validation error')
    }
  }

  return linkIndexer.report()
}
