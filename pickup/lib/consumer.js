import retry from 'async-retry'
import { Consumer } from 'sqs-consumer'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { createS3Uploader } from './s3.js'
import { testIpfsApi } from './ipfs.js'
import { pickupBatch } from './pickupBatch.js'
import { logger } from './logger.js'

/**
 * Delete a message from ths SQS queue
 *
 * @param {import('@aws-sdk/client-sqs'.SQSClient)} opts.sqs - The SQS client
 * @param string queueUrl - The Sqs Queue URL
 * @param {import('@aws-sdk/client-sqs'.Message)} opts.message - The SQS message
 * @returns {Promise<void>}
 */
export async function deleteMessage ({ sqs, queueUrl }, message) {
  const deleteParams = {
    QueueUrl: queueUrl,
    ReceiptHandle: message.ReceiptHandle
  }
  try {
    await sqs
      .deleteMessage(deleteParams)
      .promise()
  } catch (err) {
    logger.error({ err }, 'SQS delete message failed')
    throw err
  }
}

/**
 * Create the consumer for the SQS queue.
 *
 * @param string opts.ipfsApiUrl - The URL of the IPFS server.
 * @param string opts.queueUrl - The Sqs Queue URL.
 * @param {import('@aws-sdk/client-s3'.S3Client)} opts.s3 - The S3 client.
 * @param int opts.batchSize - The size of the concurrent batch.
 * @param int opts.maxRetry - The number of max retry before set the pin request to failed.
 * @param int opts.visibilityTimeout - The message visibility timeout in seconds, used internally by sqs-consumer.
 * @param int opts.heartbeatInterval - The message heartbeatInterval in seconds, used internally by sqs-consumer.
 * @param int opts.handleMessageTimeout - The max limit for the car download in milliseconds, used internally by sqs-consumer.
 * @param int opts.testMaxRetry - The max retry to check if the IPFS server is available.
 * @param int opts.testTimeoutMs - The timeout in millisecond for each IPFS availability try.
 * @param opts.timeoutFetchMs - The timeout for each fetch in milliseconds. The Download is set to `failed` if the IPFS server
 *                              fetch action do not respond while is downloading the blocks.
 * @param string opts.dynamoTable - The dynamo DB table
 * @param string opts.dynamoEndpoint - The dynamo DB endpoint
 * @returns {Promise<Consumer>}
 */
export async function createConsumer ({
  ipfsApiUrl,
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
  // throws if can't connect
  await retry(() => {
    return testIpfsApi(ipfsApiUrl, testTimeoutMs)
  }, { retries: testMaxRetry })

  const dynamo = new DynamoDBClient({ endpoint: dynamoEndpoint })

  logger.info({ batchSize, visibilityTimeout, heartbeatInterval, queueUrl, handleMessageTimeout, maxRetry, timeoutFetchMs }, 'Create sqs consumer')

  const app = Consumer.create({
    queueUrl,
    // The message deletion is managed manually
    shouldDeleteMessages: false,
    // needs partial acks before we can increase batch size
    // see: https://github.com/bbc/sqs-consumer/pull/255
    batchSize, // 1 to 10
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
      return pickupBatch(messages, {
        ipfsApiUrl,
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
    if (
      (err.code === 'MissingParameter' || err.constructor.name === 'MissingParameter') &&
      err.message.includes('Error changing visibility timeout: The request must contain the parameter ChangeMessageVisibilityBatchRequestEntry')) {
      logger.trace({ err }, 'The sqs-library is trying to  change the visibility of the timeout of an empty message list')
      return
    }

    logger.error({ err }, 'App error')
  })

  app.on('processing_error', (err) => {
    logger.error({ err }, 'App processing error')
  })
  return app
}
