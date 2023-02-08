import { createConsumer } from './lib/consumer.js'
import { logger } from './lib/logger.js'
import { DownloadStatusManager } from './lib/downloadStatusManager.js'

const { IPFS_API_URL, SQS_QUEUE_URL, DYNAMO_TABLE_NAME, DYNAMO_DB_ENDPOINT, BATCH_SIZE, MAX_RETRY, TIMEOUT_FETCH } = process.env

if (!IPFS_API_URL) throw new Error('IPFS_API_URL not found in ENV')
if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')
if (!DYNAMO_TABLE_NAME) throw new Error('DYNAMO_TABLE_NAME not found in ENV')

async function start () {
  logger.info({}, 'Pickup starting...')
  const app = await createConsumer({
    ipfsApiUrl: IPFS_API_URL,
    queueUrl: SQS_QUEUE_URL,
    dynamoTable: DYNAMO_TABLE_NAME,
    dynamoEndpoint: DYNAMO_DB_ENDPOINT || undefined,
    batchSize: Number(BATCH_SIZE || 1),
    maxRetry: Number(MAX_RETRY || 5),
    timeoutFetchMs: Number(TIMEOUT_FETCH || 30) * 1000,
    downloadStatusManager: new DownloadStatusManager()
  })

  app.on('message_received', msg => {
    const { requestid, cid } = JSON.parse(msg.Body)
    logger.info({ requestid, cid }, 'Processing request')
  })
  app.start()
  logger.info({}, `Pickup subscribed to ${SQS_QUEUE_URL}`)
}

start()
