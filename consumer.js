import { Consumer } from 'sqs-consumer'
import { pickup } from './plugins/pickup'
import { createS3Client } from './plugins/s3'

const { GATEWAY_URL, NODE_ENV, SQS_QUEUE_URL } = process.env

const client = createS3Client(process.env)

const app = Consumer.create({
  queueUrl: SQS_QUEUE_URL,
  handleMessage: async (message) => {
    await pickup({ client, GATEWAY_URL, NODE_ENV }, JSON.parse(message.body))
  }
})

app.on('error', (err) => {
  console.error(err.message)
})

app.on('processing_error', (err) => {
  console.error(err.message)
})

app.start()
