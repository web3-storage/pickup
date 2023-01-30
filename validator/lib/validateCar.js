// import { fetchCar, connectTo, disconnect, waitForGC, ERROR_TIMEOUT } from './ipfs.js'
// import { deleteMessage } from './consumer.js'
// import { updatePinStatus } from './dynamo.js'
import { logger } from './logger.js'

/**
 * Fetch CARs for a batch of SQS messages.
 * @param {import('sqs-consumer').SQSMessage[]} messages
 * @param {Object} opts
 * @param {string} opts.ipfsApiUrl
 * @param {Function} opts.createS3Uploader
 * @param {import('@aws-sdk/client-s3'.S3Client)} opts.s3
 * @returns {Promise<SQSMessage[]>}
 */
export async function validateCar (messages, { ipfsApiUrl, createS3Uploader, s3, queueManager, dynamo, dynamoTable, timeoutFetchMs, maxRetry }) {
  logger.info({ messages }, 'Validate car start')
  console.log(JSON.stringify(messages))

  return true
}
