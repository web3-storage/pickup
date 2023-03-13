import { Squiss } from 'squiss-ts'
import { CarFetcher, TOO_BIG, CHUNK_TOO_SLOW, FETCH_TOO_SLOW } from './ipfs.js'
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
    VALIDATION_BUCKET
  } = env

  if (!IPFS_API_URL) throw new Error('IPFS_API_URL not found in ENV')
  if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')
  if (!VALIDATION_BUCKET) throw new Error('VALIDATION_BUCKET not found in ENV')

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
      bucket: VALIDATION_BUCKET
    })
  })

  return pickup
}

/**
 * @param {object} config
 * @param {Squiss} config.sqsPoller
 * @param {CarFetcher} config.carFetcher
 * @param {S3Uploader} config.s3Uploader
 */
export function createPickup ({ sqsPoller, carFetcher, s3Uploader }) {
  /**
   * @param {import('squiss-ts').Message} msg
   */
  async function messageHandler (msg) {
    const { cid, origins, key } = msg.body
    const abortCtl = new AbortController()
    const upload = s3Uploader.createUploader({ cid, key })
    try {
      await carFetcher.connectTo(origins)
      const body = await carFetcher.fetch({ cid, origins, abortCtl })
      await upload(body)
      logger.info({ cid }, 'OK. Car in S3')
      msg.del() // the message is handled, remove it from queue.
    } catch (err) {
      if (abortCtl.signal.reason === TOO_BIG) {
        logger.error({ cid, err }, 'Failed to fetch CAR: Too big')
        return msg.release()
      }
      if (abortCtl.signal.reason === CHUNK_TOO_SLOW) {
        logger.error({ cid, err }, 'Failed to fetch CAR: chunk too slow')
        return msg.release()
      }
      if (abortCtl.signal.reason === FETCH_TOO_SLOW) {
        logger.error({ cid, err }, 'Failed to fetch CAR: fetch too slow')
        return msg.release()
      }
      logger.error({ cid, err }, 'Failed to fetch CAR')
      return msg.release() // back to the queue, try again
    } finally {
      await carFetcher.disconnect(origins)
      await carFetcher.waitForGc()
    }
  }

  sqsPoller.on('message', messageHandler)

  const pollerStart = sqsPoller.start.bind(sqsPoller)
  sqsPoller.start = async () => {
    // throw if we can't connect to kubo
    await carFetcher.testIpfsApi()
    return pollerStart()
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
