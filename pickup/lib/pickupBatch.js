import { fetchCar, connectTo, disconnect, waitForGC, ERROR_TIMEOUT } from './ipfs.js'
import { updatePinStatus } from './dynamo.js'
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
export async function pickupBatch (messages, { ipfsApiUrl, createS3Uploader, s3, queueManager, dynamo, dynamoTable }) {
  const jobs = []
  const allOrigins = []

  logger.info({ messages }, 'Pickup batch start')

  for (const message of messages) {
    const { cid, origins, bucket, key, requestid } = JSON.parse(message.Body)
    logger.trace({ cid, requestid }, 'Push message in job list')
    jobs.push({ message, requestid, cid, upload: createS3Uploader({ bucket, key, client: s3 }) })
    allOrigins.concat(origins)
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
  const requestIds = jobs.map(({ requestid }) => requestid)

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
      const body = await fetchCar(cid, ipfsApiUrl, downloadError)
      logger.info({ cid, requestid, messageId: message.MessageId }, 'IPFS node responded, downloading the car')
      await upload({ body, cid, downloadError })
      logger.info({ cid, requestid, messageId: message.MessageId }, 'Car downloaded and stored in S3')

      // After the download some low level action are required to override the `sqs-consumer` library limit.
      // The library works with the full batch and the is required to remove the messages while they are processed.
      // The processed message is removed from the queue list to avoid further changeVisabilityTimeout.
      const arrayRemoveIndex = requestIds.indexOf(requestid)
      requestIds.splice(Number(arrayRemoveIndex), 1)
      messages.splice(Number(arrayRemoveIndex), 1)
      logger.trace({ cid, requestid, messageId: message.MessageId, arrayRemoveIndex }, 'Removed processed message from the messages')

      await queueManager.deleteMessage(message)

      resultStats[cid] = 'success'
    } catch (err) {
      // The processed message is removed from the queue list to avoid further changeVisabilityTimeout.
      const arrayRemoveIndex = requestIds.indexOf(requestid)
      requestIds.splice(Number(arrayRemoveIndex), 1)
      messages.splice(Number(arrayRemoveIndex), 1)

      if (downloadError.code === ERROR_TIMEOUT) {
        logger.info({ cid, requestid, messageId: message.MessageI, arrayRemoveIndex }, 'Download timeout')
        // Update the status on dynamodb to failed
        await updatePinStatus(dynamo, dynamoTable, cid, 'failed')

        // Delete the message from the queue
        await queueManager.deleteMessage(message)
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
