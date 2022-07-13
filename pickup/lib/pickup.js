import { fetchCar, connectTo, disconnect } from './ipfs.js'

export async function pickup ({ upload, ipfsApiUrl, cid, origins }) {
  // console.log(`Fetching req: ${requestid} cid: ${cid}`)
  // TODO: check if the work still needs to be done. by asking EP.
  try {
    await connectTo(origins, ipfsApiUrl)
    const body = await fetchCar(cid, ipfsApiUrl)
    await upload({ body })
  } finally {
    await disconnect(origins, ipfsApiUrl)
  }
  return { cid, origins }
}
