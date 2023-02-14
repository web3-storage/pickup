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

export class InvalidCarError extends Error {
  /**
   * @param {string} reason
   */
  constructor (reason) {
    super(`Invalid CAR file received: ${reason}`)
    this.name = 'InvalidCar'
    this.status = 400
    this.code = InvalidCarError.CODE
  }
}
InvalidCarError.CODE = 'ERROR_INVALID_CAR'

export async function carStats (carBytes) {
  const blocksIterator = await CarBlockIterator.fromIterable(carBytes)

  const linkIndexer = new LinkIndexer()

  let blocks = 0
  for await (const block of blocksIterator) {
    try {
      linkIndexer.decodeAndIndex(block)
      blocks++
    } catch (err) {
      logger.error({ err }, 'Block validation error')
    }
  }

  if (blocks === 0) {
    throw new InvalidCarError('empty CAR')
  }

  const structure = linkIndexer.getDagStructureLabel()
  return { structure }
}
