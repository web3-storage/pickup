import { Consumer } from 'sqs-consumer'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { createS3Uploader } from './s3.js'
import { processCars } from './processCars.js'
import { logger } from './logger.js'

export async function createConsumer ({
  queueUrl,
  s3,
  batchSize = 10,
  maxRetry = 5,
  visibilityTimeout = 20,
  heartbeatInterval = 10,
  handleMessageTimeout = 4 * 60 * 60 * 1000,
  timeoutFetchMs = 30000,
  dynamoTable,
  dynamoEndpoint
}) {
  const dynamo = new DynamoDBClient({ endpoint: dynamoEndpoint })

  logger.info({
    batchSize,
    visibilityTimeout,
    heartbeatInterval,
    queueUrl,
    handleMessageTimeout,
    maxRetry,
    timeoutFetchMs
  }, 'Create sqs consumer')

  const app = Consumer.create({
    queueUrl,
    // needs partial acks before we can increase batch size
    // see: https://github.com/bbc/sqs-consumer/pull/255
    batchSize: 1, // 1 to 10
    visibilityTimeout, // seconds, how long to hide message from queue after reading.
    heartbeatInterval, // seconds, must be lower than `visibilityTimeout`. how long before increasing the `visibilityTimeout`
    attributeNames: ['ApproximateReceiveCount'], // log retries
    handleMessageTimeout, // ms, error if processing takes longer than this.
    handleMessage: async (message) => {
      return processCars(message, {
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
