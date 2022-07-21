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
