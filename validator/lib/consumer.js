import { Consumer } from 'sqs-consumer'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { createS3Client } from './s3.js'
import { processCars } from './processCars.js'
import { logger } from './logger.js'

/**
 * Create the SQS consumer
 *
 * @param {string} queueUrl
 * @param {import('@aws-sdk/client-s3'.S3Client)} s3
 * @param {number} visibilityTimeout
 * @param {number} heartbeatInterval
 * @param {number} handleMessageTimeout
 * @param {string} dynamoTable
 * @param {string} dynamoEndpoint
 * @param {string} validationBucket
 * @returns {Promise<Consumer>}
 */
export async function createConsumer ({
  queueUrl,
  s3 = createS3Client(),
  visibilityTimeout = 20,
  heartbeatInterval = 10,
  handleMessageTimeout = 4 * 60 * 60 * 1000,
  dynamoTable,
  dynamoEndpoint,
  validationBucket
}) {
  const dynamo = new DynamoDBClient({ endpoint: dynamoEndpoint })

  logger.info({
    visibilityTimeout,
    heartbeatInterval,
    queueUrl,
    handleMessageTimeout,
    validationBucket
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
        s3,
        queueManager: app,
        dynamo,
        dynamoTable,
        validationBucket
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
