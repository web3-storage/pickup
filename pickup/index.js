import { createConsumer } from './lib/consumer.js'

const { IPFS_API_URL, SQS_QUEUE_URL } = process.env
if (!IPFS_API_URL) throw new Error('IPFS_API_URL not found in ENV')
if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')

async function start () {
  console.log('Pickup starting...')
  const app = await createConsumer({
    ipfsApiUrl: IPFS_API_URL,
    queueUrl: SQS_QUEUE_URL
  })
  app.on('message_received', msg => {
    const { requestid, cid } = JSON.parse(msg.Body)
    console.log(`Processing req: ${requestid} cid: ${cid}`)
    console.log(JSON.stringify(msg, null, 4));
    // console.log(`Failing to test retries and DLQ. SQS MessageReceiveCount = ${msg.attributes?.ApproximateReceiveCount}`)
    // console.error(`Failing to test retries and DLQ. SQS MessageReceiveCount = ${msg.attributes?.ApproximateReceiveCount}`)
    // throw new Error(`Failing to test retries and DLQ. SQS MessageReceiveCount = ${msg.attributes?.ApproximateReceiveCount}`)
  })
  app.start()
  console.log(`Pickup subscribed to ${SQS_QUEUE_URL}`)
}

start()
