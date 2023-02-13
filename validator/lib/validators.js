import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { CarBlockIterator } from '@ipld/car'
import { LinkIndexer } from 'linkdex'
import { maybeDecode } from 'linkdex/decode.js'
import { equals } from 'uint8arrays'
import * as raw from 'multiformats/codecs/raw'
import * as pb from '@ipld/dag-pb'

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

export const MAX_BLOCK_SIZE = 1 << 21 // 2MiB

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

  const roots = await blocksIterator.getRoots()
  if (roots.length === 0) {
    throw new InvalidCarError('missing roots')
  }
  if (roots.length > 1) {
    throw new InvalidCarError('too many roots')
  }
  const linkIndexer = new LinkIndexer()
  const rootCid = roots[0]

  let rawRootBlock
  let blocks = 0
  for await (const block of blocksIterator) {
    const blockSize = block.bytes.byteLength
    if (blockSize > MAX_BLOCK_SIZE) {
      throw new InvalidCarError(`block too big: ${blockSize} > ${MAX_BLOCK_SIZE}`)
    }
    if (block.cid.multihash.code === sha256.code) {
      const ourHash = await sha256.digest(block.bytes)
      if (!equals(ourHash.digest, block.cid.multihash.digest)) {
        throw new InvalidCarError(`block data does not match CID for ${block.cid.toString()}`)
      }
    }
    if (!rawRootBlock && block.cid.equals(rootCid)) {
      rawRootBlock = block
    }
    linkIndexer.decodeAndIndex(block)
    blocks++
  }
  if (blocks === 0) {
    throw new InvalidCarError('empty CAR')
  }
  if (!rawRootBlock) {
    throw new InvalidCarError('missing root block')
  }
  let size
  // if there's only 1 block (the root block) and it's a raw node, we know the size.
  if (blocks === 1 && rootCid.code === raw.code) {
    size = rawRootBlock.bytes.byteLength
  } else {
    const rootBlock = maybeDecode(rawRootBlock)
    if (rootBlock) {
      const hasLinks = !rootBlock.links()[Symbol.iterator]().next().done
      // if the root block has links, then we should have at least 2 blocks in the CAR
      if (hasLinks && blocks < 2) {
        throw new InvalidCarError('CAR must contain at least one non-root block')
      }
      // get the size of the full dag for this root, even if we only have a partial CAR.
      if (rootBlock.cid.code === pb.code) {
        size = cumulativeSize(rootBlock.bytes, rootBlock.value)
      }
    }
  }
  const structure = linkIndexer.getDagStructureLabel()
  return { size, blocks, rootCid, structure }
}

/**
 * The sum of the node size and size of each link
 * @param {Uint8Array} pbNodeBytes
 * @param {import('@ipld/dag-pb/src/interface').PBNode} pbNode
 * @returns {number} the size of the DAG in bytes
 */
function cumulativeSize (pbNodeBytes, pbNode) {
  // NOTE: Tsize is optional, but all ipfs implementations we know of set it.
  // It's metadata, that could be missing or deliberately set to an incorrect value.
  // This logic is the same as used by go/js-ipfs to display the cumulative size of a dag-pb dag.
  return pbNodeBytes.byteLength + pbNode.Links.reduce((acc, curr) => acc + (curr.Tsize || 0), 0)
}
