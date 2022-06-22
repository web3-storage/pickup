import { fetchCar, connectTo, disconnect } from '../plugins/ipfs'

export default async function routes (fastify) {
  fastify.get('/', async () => {
    return { hello: 'pickup' }
  })

  fastify.post('/pins/:cid', async function ({ params }) {
    const { GATEWAY_URL } = fastify.env
    const cid = params.cid
    const origins = []
    const key = fastify.toBucketKey({ cid, userId: 'test', appName: 'test-app' })

    // TODO: check if the work still needs to be done. by asking EP.
    try {
      await connectTo(origins, GATEWAY_URL)
      const body = fetchCar(cid, GATEWAY_URL)
      await fastify.sendToS3({ body, key })
    } finally {
      await disconnect(origins, GATEWAY_URL)
    }

    return { cid: params.cid }
  })
}
