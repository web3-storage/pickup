import { Consumer } from 'sqs-consumer'
import { fetchCar, connectTo, disconnect } from './plugins/car.js'
import { createS3Client, sendToS3 } from './plugins/s3.js'

const { GATEWAY_URL, NODE_ENV, SQS_QUEUE_URL } = process.env

const client = createS3Client(process.env)

const app = Consumer.create({
  queueUrl: SQS_QUEUE_URL,
  handleMessage: async (message) => {
    const { requestid, cid, origins, bucket, key } = JSON.parse(message.body)
    console.log(`Fetching req: ${requestid} cid: ${cid}`)

    // TODO: check if the work still needs to be done. by asking EP.
    try {
      await connectTo(origins, GATEWAY_URL)
      const body = fetchCar(cid, GATEWAY_URL)
      await sendToS3({ client, bucket, NODE_ENV }, { body, key })
    } finally {
      await disconnect(origins, GATEWAY_URL)
    }
  }
})

app.on('error', (err) => {
  console.error(err.message)
})

app.on('processing_error', (err) => {
  console.error(err.message)
})

app.start()
