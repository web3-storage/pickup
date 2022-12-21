import { fetchCar, connectTo, disconnect, waitForGC } from './ipfs.js'

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
export async function pickupBatch (messages, { ipfsApiUrl, createS3Uploader, s3 }) {
  const jobs = []
  const allOrigins = []
  for (const message of messages) {
    const { cid, origins, bucket, key, requestid } = JSON.parse(message.Body)
    jobs.push({ message, requestid, cid, upload: createS3Uploader({ bucket, key, client: s3 }) })
    allOrigins.concat(origins)
  }

  // Prepare!
  await Promise.all([
    waitForGC(ipfsApiUrl),
    connectTo(allOrigins, ipfsApiUrl)
  ])

  console.log(`Ready to process ${jobs.length} jobs`)

  // Do!
  const res = await Promise.allSettled(jobs.map(async job => {
    const { message, cid, upload } = job
    const body = await fetchCar(cid, ipfsApiUrl)
    console.log(`got car for ${cid}`)
    await upload({ body })
    console.log(`uploaded car for ${cid} to s3`)
    return message // hand back msg so we can ack all that succeded
  }))

  // Clear!
  await disconnect(allOrigins, ipfsApiUrl)

  // find the ones that worked
  const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value)

  console.log(`Done processing batch ${jobs[0].cid}. ${ok.length}/${messages.length} OK`)

  // return the set of messages that were handled
  return ok
}
