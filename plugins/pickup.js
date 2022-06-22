import { fetchCar, connectTo, disconnect } from './ipfs.js'
import { sendToS3 } from './s3.js'

export async function pickup ({ client, GATEWAY_URL, NODE_ENV }, { requestid, cid, origins, bucket, key }) {
  console.log(`Fetching req: ${requestid} cid: ${cid}`)
  // TODO: check if the work still needs to be done. by asking EP.
  try {
    await connectTo(origins, GATEWAY_URL)
    const body = await fetchCar(cid, GATEWAY_URL)
    await sendToS3({ client, bucket, NODE_ENV }, { body, key })
  } finally {
    await disconnect(origins, GATEWAY_URL)
  }
  return { requestid, cid, origins, bucket, key }
}
