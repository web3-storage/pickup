import { Consumer } from 'sqs-consumer'
import { pickup } from './lib/pickup.js'
import { createS3Uploader } from './lib/s3.js'

const { GATEWAY_URL, SQS_QUEUE_URL } = process.env

if (!GATEWAY_URL) throw new Error('GATEWAY_URL not found in ENV')
if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL not found in ENV')

const app = Consumer.create({
  // it will inject the queue URI into the service container under the environment variable SQS_QUEUE_URL.
  // https://aws.github.io/copilot-cli/docs/developing/publish-subscribe/#subscribing-to-a-topic-with-a-worker-service
  queueUrl: SQS_QUEUE_URL,
  handleMessage: async (message) => {
    const { cid, origins, bucket, key/*, resquestid */ } = JSON.parse(message.Body)
    await pickup({
      upload: createS3Uploader({ bucket, key }),
      ipfsApiUrl: GATEWAY_URL,
      origins,
      cid
    })
  }
})

app.on('error', (err) => {
  console.error(err.message)
})

app.on('processing_error', (err) => {
  console.error(err.message)
})

app.start()
console.log(`Pickup subscribed to ${SQS_QUEUE_URL}`)
