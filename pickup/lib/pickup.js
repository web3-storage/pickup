import { Squiss, Message } from 'squiss-ts'
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
    queuePoller: createSqsPoller({
      queueUrl: SQS_QUEUE_URL,
      maxInFlight: BATCH_SIZE 
    }),
    carFetcher: new CarFetcher({
      ipfsApiUrl: IPFS_API_URL,
      fetchTimeoutMs: TIMEOUT_FETCH
    }),
    s3Uploader: new S3Uploader({
      s3: new S3Client(),
      bucket: VALIDATION_BUCKET
    })
  })

  return pickup
}

/**
 * @param {object} config
 * @param {Squiss} config.queuePoller
 * @param {CarFetcher} config.carFetcher
 * @param {S3Uploader} config.s3Uploader
 */
export async function createPickup ({ queuePoller, carFetcher, s3Uploader }) {
  await testIpfsApi(carFetcher.ipfsApiUrl)

  /**
   * @param {Message} msg
   */
  async function messageHandler (msg) {
    const { cid, origins, key } = msg.body
    try {
      logger.info({ cid }, 'Fetching car')
      const uploader = s3Uploader.createUploader({ cid, key })
      await carFetcher.fetch({ cid, origins, uploader })
      logger.info({ cid }, 'OK. Car in S3')
      msg.del() // the message is handled, remove it from queue.
    } catch (error) {
      logger.info({ cid, error }, `Error ${ err.message || err }`)
      // return the msg to the queue for another go
      msg.release()
    }
  }
 
  queuePoller.on('message', messageHandler)
 
  return queuePoller
 }

/**
 * @param {import('squiss-ts').ISquissOptions} config
 */
export function createSqsPoller (config) {
  return new Squiss({
    // set our default overrides here, we always want these.
    autoExtendTimeout: true,
    bodyFormat: 'json',
    ...config
  })
}

