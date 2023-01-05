import retry from 'p-retry'
import { Consumer } from 'sqs-consumer'
import { createS3Uploader } from './s3.js'
import { testIpfsApi } from './ipfs.js'
import { pickupBatch } from './pickup.js'
import { Traceroute } from 'nodejs-traceroute'

export async function createConsumer ({ ipfsApiUrl, queueUrl, s3 }) {
  // throws if can't connect
  await retry(() => testIpfsApi(ipfsApiUrl), { maxRetryTime: 1000 * 5 })

  const app = Consumer.create({
    queueUrl,
    // needs partial acks before we can increase batch size
    // see: https://github.com/bbc/sqs-consumer/pull/255
    batchSize: 1, // 1 to 10
    visibilityTimeout: 20, // seconds, how long to hide message from queue after reading.
    heartbeatInterval: 10, // seconds, must be lower than `visibilityTimeout`. how long before increasing the `visibilityTimeout`
    attributeNames: ['ApproximateReceiveCount'], // log retries
    // allow 4hrs before timeout. 2/3rs of the world can upload faster than
    // 20Mbit/s (fixed broadband), at which 32GiB would transfer in 3.5hrs.
    // we can make this more or less generous, but note it ties up a worker.
    // see: https://www.speedtest.net/global-index
    // see: https://www.omnicalculator.com/other/download-time?c=GBP&v=fileSize:32!gigabyte,downloadSpeed:5!megabit
    // TODO: enforce 32GiB limit
    handleMessageTimeout: 4 * 60 * 60 * 1000, // ms, error if processing takes longer than this.
    handleMessageBatch: async (messages) => {
      try {
        const tracer = new Traceroute()
        tracer
          .on('pid', (pid) => {
            console.log(`pid: ${pid}`)
          })
          .on('destination', (destination) => {
            console.log(`destination: ${destination}`)
          })
          .on('hop', (hop) => {
            console.log(`hop: ${JSON.stringify(hop)}`)
          })
          .on('close', (code) => {
            console.log(`close: code ${code}`)
          })
        tracer.trace('github.com')
      } catch (ex) {
        console.log(ex)
      }
      return pickupBatch(messages, { ipfsApiUrl, createS3Uploader, s3 })
    }
  })

  app.on('error', (err) => {
    // TODO: Log Receive Count (Retries): ${msg.Attributes?.ApproximateReceiveCount}
    console.error(err.message)
  })

  app.on('processing_error', (err) => {
    console.error(err.message)
  })

  return app
}
