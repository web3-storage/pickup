import { Consumer } from 'sqs-consumer'
import { pickup } from './plugins/pickup'
import { createS3Client } from './plugins/s3'

const { GATEWAY_URL, NODE_ENV, COPILOT_QUEUE_URI } = process.env

const client = createS3Client(process.env)

const app = Consumer.create({
  // it will inject the queue URI into the service container under the environment variable COPILOT_QUEUE_URI.
  // https://aws.github.io/copilot-cli/docs/developing/publish-subscribe/#subscribing-to-a-topic-with-a-worker-service
  queueUrl: COPILOT_QUEUE_URI,
  handleMessage: async (message) => {
    await pickup({ client, GATEWAY_URL, NODE_ENV }, JSON.parse(message.Body))
  }
})

app.on('error', (err) => {
  console.error(err.message)
})

app.on('processing_error', (err) => {
  console.error(err.message)
})

app.start()
