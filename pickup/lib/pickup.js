import { Squiss } from 'squiss-ts'
import { CarFetcher, testIpfsApi } from './ipfs.js'
import { S3Uploader } from './s3.js'
import { logger } from './logger.js'

/**
 * Use me in prod to set all the things.
 *
 * @param {Record<string, string>} env
 */
export async function createPickupFromEnv (env = process.env) {
  const {
    IPFS_API_URL,
    SQS_QUEUE_URL,
    BATCH_SIZE,
    TIMEOUT_FETCH,
    VALIDATION_BUCKET
  } = env

  if (!IPFS_API_URL) throw new Error('IPFS_API_URL not found in ENV')
  if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')
  if (!VALIDATION_BUCKET) throw new Error('VALIDATION_BUCKET not found in ENV')

  const pickup = await createPickup({
    sqsPoller: createSqsPoller({
      queueUrl: SQS_QUEUE_URL,
      maxInFlight: BATCH_SIZE
    }),
    carFetcher: new CarFetcher({
      ipfsApiUrl: IPFS_API_URL,
      fetchTimeoutMs: TIMEOUT_FETCH
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
export async function createPickup ({ sqsPoller, carFetcher, s3Uploader }) {
  // throw if we can't connect to kubo
  await testIpfsApi(carFetcher.ipfsApiUrl)

  /**
   * @param {import('squiss-ts').Message} msg
   */
  async function messageHandler (msg) {
    const { cid, origins, key } = msg.body
    try {
      logger.info({ cid }, 'Fetching car')
      const upload = s3Uploader.createUploader({ cid, key })
      await carFetcher.fetch({ cid, origins, upload })
      logger.info({ cid }, 'OK. Car in S3')
      msg.del() // the message is handled, remove it from queue.
    } catch (err) {
      logger.error({ cid, err }, 'Failed to fetch CAR')
      // return the msg to the queue for another go
      msg.release()
    }
  }

  sqsPoller.on('message', messageHandler)

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

    // allow 4hrs before timeout. 2/3rs of the world can upload faster than
    // 20Mbit/s (fixed broadband), at which 32GiB would transfer in 3.5hrs.
    // see: https://www.speedtest.net/global-index
    // see: https://www.omnicalculator.com/other/download-time?c=GBP&v=fileSize:32!gigabyte,downloadSpeed:5!megabit
    // TODO: enforce 32GiB limit
    noExtensionsAfterSecs: 4 * 60 * 60,
    bodyFormat: 'json',
    ...config
  })
}
