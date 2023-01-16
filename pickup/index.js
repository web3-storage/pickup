import { createConsumer } from './lib/consumer.js'

const { IPFS_API_URL, SQS_QUEUE_URL, DYNAMO_TABLE_NAME, DYNAMO_DB_ENDPOINT } = process.env
if (!IPFS_API_URL) throw new Error('IPFS_API_URL not found in ENV')
if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')

async function start () {
  console.log('Pickup starting...')
  const app = await createConsumer({
    ipfsApiUrl: IPFS_API_URL,
    queueUrl: SQS_QUEUE_URL,
    dynamoTable: DYNAMO_TABLE_NAME,
    dynamoEndpoint: DYNAMO_DB_ENDPOINT,
  })

  app.on('message_received', msg => {
    const { requestid, cid } = JSON.parse(msg.Body)
    console.log(`Processing req: ${requestid} cid: ${cid}`)
  })
  app.start()
  console.log(`Pickup subscribed to ${SQS_QUEUE_URL}`)
}

start()
