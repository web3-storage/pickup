import { createConsumer } from './lib/consumer.js'

const { IPFS_API_URL, SQS_QUEUE_URL } = process.env
if (!IPFS_API_URL) throw new Error('IPFS_API_URL not found in ENV')
if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')

async function start () {
  const app = await createConsumer({
    ipfsApiUrl: IPFS_API_URL,
    queueUrl: SQS_QUEUE_URL
  })

  app.start()
  console.log(`Pickup subscribed to ${SQS_QUEUE_URL}`)
}

start()
