import { fetchCar } from '../plugins/car'

export default async function routes (fastify) {
  fastify.get('/', async () => {
    return { hello: 'pickup' }
  })

  fastify.post('/pins/:cid', async function ({ params }) {
    const cid = params.cid
    const body = await fetchCar(cid, this.env.GATEWAY_URL)
    const key = fastify.toBucketKey({ cid, userId: 'test', appName: 'test-app' })
    await fastify.sendToS3({ body, key })
    return { cid: params.cid }
  })
}
