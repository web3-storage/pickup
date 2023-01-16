import { fetchCar, connectTo, disconnect, waitForGC } from './ipfs.js'
import {updatePinStatus} from "./dynamo.js"

export async function pickup ({ upload, ipfsApiUrl, cid, origins }) {
  // TODO: check if the work still needs to be done. by asking EP.
  try {
    await connectTo(origins, ipfsApiUrl)
    const body = await fetchCar(cid, ipfsApiUrl)
    await upload({ body })
  } finally {
    await disconnect(origins, ipfsApiUrl)
    await waitForGC(ipfsApiUrl)
  }
  return { cid, origins }
}

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
  for (const message of messages) {
    const { cid, origins, bucket, key, requestid } = JSON.parse(message.Body)
    console.log('Create uploader', cid, key)
    jobs.push({ message, requestid, cid, upload: createS3Uploader({ bucket, key, client: s3 }) })
    allOrigins.concat(origins)
  }
  // Prepare!
  await Promise.all([
    waitForGC(ipfsApiUrl),
    connectTo(allOrigins, ipfsApiUrl)
  ])

  console.log(`Ready to process ${jobs.length} jobs`)

  const totalMessages = messages.length
  const referenceIds = jobs.map(({ requestid}) => requestid)
  // Do!
  const res = await Promise.allSettled(jobs.map(async job => {
    const { message, cid, upload, requestid } = job
    console.log('Init: ', cid, requestid)
    const downloadError = {}

    try {
      const body = await fetchCar(cid, ipfsApiUrl, downloadError)
      console.log(`IPFS node responded, downloading the car for ${cid}`)
      const result = await upload({ body, cid, downloadError })
      console.log('RequestId', requestid, message.MessageId)
      console.log(`uploaded car for ${cid} to s3`)
      const toRemove = referenceIds.indexOf(requestid)
      referenceIds.splice(Number(toRemove), 1)
      messages.splice(Number(toRemove), 1)
      queueManager.emit('message_processed', message)
    } catch (e) {
      console.log('+++++++++++ TIMEOUT', downloadError)
      if (downloadError.code === 'TIMEOUT') {
        console.log('CID:', cid)
        await updatePinStatus(dynamo, dynamoTable, cid, 'failed')
      }
      throw e
    }
    return message // hand back msg so we can ack all that succeded
  }))

  console.log('ESCO DA QUI')
  console.log(res)

  // Clear!
  await disconnect(allOrigins, ipfsApiUrl)
  // find the ones that worked

  const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value)
  // If a download fails for an unexpected error it should return the message on the queue

  // If a download fails for timeout, not found error it should just set the error on dynamodb (status FAILED)
  console.log(`Done processing batch ${jobs[0].cid}. ${ok.length}/${totalMessages} OK`)

  // return the set of messages that were handled
  return ok
}
