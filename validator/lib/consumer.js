import { Consumer } from 'sqs-consumer'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { createS3Uploader } from './s3.js'
import { validateCar } from './validateCar.js'
import { logger } from './logger.js'

export async function createConsumer ({
  queueUrl,
  s3,
  batchSize = 10,
  maxRetry = 5,
  visibilityTimeout = 20,
  heartbeatInterval = 10,
  handleMessageTimeout = 4 * 60 * 60 * 1000,
  testMaxRetry = 5,
  testTimeoutMs = 10000,
  timeoutFetchMs = 30000,
  dynamoTable,
  dynamoEndpoint
}) {
  const dynamo = new DynamoDBClient({ endpoint: dynamoEndpoint })

  logger.info({ batchSize, visibilityTimeout, heartbeatInterval, queueUrl, handleMessageTimeout, maxRetry, timeoutFetchMs }, 'Create sqs consumer')

  const app = Consumer.create({
    queueUrl,
    // needs partial acks before we can increase batch size
    // see: https://github.com/bbc/sqs-consumer/pull/255
    batchSize: 1, // 1 to 10
    visibilityTimeout, // seconds, how long to hide message from queue after reading.
    heartbeatInterval, // seconds, must be lower than `visibilityTimeout`. how long before increasing the `visibilityTimeout`
    attributeNames: ['ApproximateReceiveCount'], // log retries
    // allow 4hrs before timeout. 2/3rs of the world can upload faster than
    // 20Mbit/s (fixed broadband), at which 32GiB would transfer in 3.5hrs.
    // we can make this more or less generous, but note it ties up a worker.
    // see: https://www.speedtest.net/global-index
    // see: https://www.omnicalculator.com/other/download-time?c=GBP&v=fileSize:32!gigabyte,downloadSpeed:5!megabit
    // TODO: enforce 32GiB limit
    handleMessageTimeout, // ms, error if processing takes longer than this.
    handleMessageBatch: async (messages) => {
      return validateCar(messages, {
        createS3Uploader,
        s3,
        queueManager: app,
        dynamo,
        dynamoTable,
        timeoutFetchMs,
        maxRetry
      })
    }
  })

  app.on('error', (err) => {
    logger.error({ err }, 'App error')
  })

  app.on('processing_error', (err) => {
    logger.error({ err }, 'App processing error')
  })
  return app
}
