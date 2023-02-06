import { fetchCar, connectTo, disconnect, waitForGC, ERROR_TIMEOUT } from './ipfs.js'
import { deleteMessage } from './consumer.js'
import { updatePinStatus } from './dynamo.js'
import { logger } from './logger.js'

/**
 * Fetch CARs for a batch of SQS messages.
 * @param {import('sqs-consumer').SQSMessage[]} messages
 * @param {string} ipfsApiUrl
 * @param {Function} createS3Uploader
 * @param {import('@aws-sdk/client-s3'.S3Client)} s3
 * @param {Consumer} queueManager
 * @param {import('@aws-sdk/lib-dynamodb'.DynamoDBClient)} dynamo
 * @param {string} dynamoTable
 * @param {number} timeoutFetchMs
 * @param {number} maxRetry
 * @returns {Promise<SQSMessage[]>}
 */
export async function pickupBatch (messages, {
  ipfsApiUrl,
  createS3Uploader,
  s3,
  queueManager,
  dynamo,
  dynamoTable,
  timeoutFetchMs,
  maxRetry
}) {
  const jobs = []
  const allOrigins = []

  logger.info({ messages }, 'Pickup batch start')

  const requestIds = []

  for (const message of messages) {
    const { cid, origins, bucket, key, requestid } = JSON.parse(message.Body)
    logger.trace({ cid, requestid }, 'Push message in job list')
    jobs.push({ message, requestid, cid, upload: createS3Uploader({ bucket, key, client: s3 }) })
    allOrigins.concat(origins)
    requestIds.push(requestid)
  }

  // Prepare!
  logger.trace({ allOrigins, ipfsApiUrl }, 'Wait for GC and connect to origins')
  await Promise.all([
    waitForGC(ipfsApiUrl),
    connectTo(allOrigins, ipfsApiUrl)
  ])

  logger.info(`Ready to process ${jobs.length} jobs`)

  // Stores the totalMessages because the `messages`array will be modified in the process
  const totalMessages = messages.length
  // Stores the requestIds to properly remove the items from the `messages` array

  // Collect the results, just for logging purpose
  const resultStats = {}

  // Do!
  const res = await Promise.allSettled(jobs.map(async job => {
    const { message, cid, upload, requestid } = job
    logger.info({ cid, requestid, messageId: message.MessageId }, 'Start job')

    // Inject a downloadError object to the `upload` function, is required to intercept the timeout error
    // because the `abort` action do not allow to pass a code to the call
    const downloadError = {}

    try {
      const body = await fetchCar(cid, ipfsApiUrl, downloadError, timeoutFetchMs)
      logger.info({ cid, requestid, messageId: message.MessageId }, 'IPFS node responded, downloading the car')
      await upload({ body, cid, downloadError })
      logger.info({ cid, requestid, messageId: message.MessageId }, 'Car downloaded and stored in S3')

      // After the download some low level action are required to override the `sqs-consumer` library limit.
      // The library works with the full batch and the is required to remove the messages while they are processed.
      // The processed message is removed from the queue list to avoid further changeVisabilityTimeout.
      const arrayRemoveIndex = requestIds.indexOf(requestid)
      requestIds.splice(Number(arrayRemoveIndex), 1)
      messages.splice(Number(arrayRemoveIndex), 1)
      logger.trace({
        cid,
        requestid,
        messageId: message.MessageId,
        arrayRemoveIndex
      }, 'Removed processed message from the messages')

      await deleteMessage(queueManager, message)

      resultStats[cid] = 'success'
    } catch (err) {
      // The processed message is removed from the queue list to avoid further changeVisabilityTimeout.
      const arrayRemoveIndex = requestIds.indexOf(requestid)
      requestIds.splice(Number(arrayRemoveIndex), 1)
      messages.splice(Number(arrayRemoveIndex), 1)

      const currentRetry = Number(message.Attributes.ApproximateReceiveCount)
      if (downloadError.code === ERROR_TIMEOUT ||
        currentRetry >= maxRetry
      ) {
        const errorMessage = currentRetry >= maxRetry ? 'Max retry' : 'Download timeout'
        logger.error({ cid, requestid, currentRetry, messageId: message.MessageI, arrayRemoveIndex },
          errorMessage)
        // Update the status on dynamodb to failed
        await updatePinStatus({
          dynamo,
          table: dynamoTable,
          cid,
          status: 'failed',
          error: errorMessage
        })

        // Delete the message from the queue
        await deleteMessage(queueManager, message)
        resultStats[cid] = 'timeout'
      } else {
        // For any other error the message from the queue is not removed,
        // then when the visibility timeout is expired the file is resend on the queue
        // A deadLetterQueue should be set to avoid infinite retry.
        logger.error({ err, cid, requestid, messageId: message.MessageI, arrayRemoveIndex }, 'Download error')
        resultStats[cid] = `fail: ${err.message}`
      }
      throw err
    } finally {
      // The message_processed event is fired.
      queueManager.emit('message_processed', message)
    }
    return message // hand back msg so we can ack all that succeded
  }))

  // Clear the origins!
  await disconnect(allOrigins, ipfsApiUrl)

  const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value)
  logger.info({ resultStats, success: ok.length, total: totalMessages }, 'Done processing batch.')

  return ok
}
