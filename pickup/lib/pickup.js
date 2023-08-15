import { Squiss } from 'squiss-ts'
import { CarFetcher, TOO_BIG, CHUNK_TOO_SLOW, FETCH_TOO_SLOW } from './ipfs.js'
import { PinTable } from './dynamo.js'
import { S3Uploader } from './s3.js'
import { logger } from './logger.js'

/**
 * Use me in prod to set all the things.
 *
 * @param {Record<string, string>} env
 */
export function createPickupFromEnv (env = process.env) {
  const {
    IPFS_API_URL,
    SQS_QUEUE_URL,
    BATCH_SIZE,
    MAX_CAR_BYTES,
    FETCH_TIMEOUT_MS,
    FETCH_CHUNK_TIMEOUT_MS,
    VALIDATION_BUCKET,
    DESTINATION_BUCKET,
    PIN_TABLE,
    DYNAMO_ENDPOINT
  } = env

  if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')
  if (!VALIDATION_BUCKET) throw new Error('VALIDATION_BUCKET not found in ENV')
  if (!DESTINATION_BUCKET) throw new Error('DESTINATION_BUCKET not found in ENV')
  if (!PIN_TABLE) throw new Error('PIN_TABLE not found in ENV')

  const pickup = createPickup({
    sqsPoller: createSqsPoller({
      queueUrl: SQS_QUEUE_URL,
      maxInFlight: BATCH_SIZE,
      noExtensionsAfterSecs: FETCH_TIMEOUT_MS
    }),
    carFetcher: new CarFetcher({
      ipfsApiUrl: IPFS_API_URL,
      maxCarBytes: MAX_CAR_BYTES,
      fetchTimeoutMs: FETCH_TIMEOUT_MS,
      fetchChunkTimeoutMs: FETCH_CHUNK_TIMEOUT_MS
    }),
    s3Uploader: new S3Uploader({
      validationBucket: VALIDATION_BUCKET,
      destinationBucket: DESTINATION_BUCKET
    }),
    pinTable: new PinTable({
      table: PIN_TABLE,
      endpoint: DYNAMO_ENDPOINT
    })
  })

  return pickup
}

/**
 * @param {object} config
 * @param {Squiss} config.sqsPoller
 * @param {CarFetcher} config.carFetcher
 * @param {S3Uploader} config.s3Uploader
 * @param {PinTable} config.pinTable
 */
export function createPickup ({ sqsPoller, carFetcher, s3Uploader, pinTable }) {
  /**
   * @param {import('squiss-ts').Message} msg
   */
  async function messageHandler (msg) {
    const { cid, origins, key } = msg.body
    const delegates = await carFetcher.findPublicMultiaddrs()
    await pinTable.addDelegates({ cid, delegates })
    const abortCtl = new AbortController()
    const upload = s3Uploader.createUploader({ cid, key })
    try {
      logger.info({ cid, origins }, 'Fetching CAR')
      await carFetcher.connectTo(origins)
      const body = await carFetcher.fetch({ cid, origins, abortCtl })
      await upload(body)
      logger.info({ cid, origins }, 'OK. Car in S3')
      await pinTable.updatePinStatus({ cid })
      await msg.del() // the message is handled, remove it from queue.
    } catch (err) {
      if (abortCtl.signal.reason === TOO_BIG) {
        logger.error({ cid, origins, err }, 'Failed to fetch CAR: Too big')
        await msg.release()
      } else if (abortCtl.signal.reason === CHUNK_TOO_SLOW) {
        logger.error({ cid, origins, err }, 'Failed to fetch CAR: chunk too slow')
        await msg.release()
      } else if (abortCtl.signal.reason === FETCH_TOO_SLOW) {
        logger.error({ cid, origins, err }, 'Failed to fetch CAR: fetch too slow')
        await msg.release()
      } else {
        logger.error({ cid, origins, err }, 'Failed to fetch CAR: other error')
        if (!msg.isHandled) {
          await msg.release() // back to the queue, try again
        }
      }
    } finally {
      await carFetcher.disconnect(origins)
      await carFetcher.waitForGc()
    }
  }

  sqsPoller.on('message', messageHandler)

  const pollerStart = sqsPoller.start.bind(sqsPoller)
  sqsPoller.start = async () => {
    try {
      // throw if we can't connect to kubo
      await carFetcher.findPublicMultiaddrs()
      return pollerStart()
    } catch (err) {
      logger.error({ err, ipfsApiUrl: carFetcher.ipfsApiUrl }, 'Failed to connect to ipfs api')
      throw new Error('Failed to connect to ipfs api')
    }
  }

  return sqsPoller
}

/**
 * @param {import('squiss-ts').ISquissOptions} config
 */
export function createSqsPoller (config) {
  return new Squiss({
    // set our default overrides here, we always want these.
    autoExtendTimeout: true,
    receiveSqsAttributes: ['ApproximateReceiveCount'],
    bodyFormat: 'json',
    ...config
  })
}
