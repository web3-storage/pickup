import fetch from 'node-fetch'

export default async function routes (fastify) {
  fastify.get('/', async () => {
    return { hello: 'pickup' }
  })

  fastify.post('/pins/:cid', async function ({ params }) {
    const body = await fetchCar(params.cid, this.env.GATEWAY_URL)
    await fastify.sendToS3({ body, cid: params.cid /* userId, appName */ })
    return { cid: params.cid }
  })
}

export async function fetchCar (cid, gateway) {
  const url = new URL(`/api/v0/dag/export?arg=${cid}`, gateway)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} ${url}`)
  }
  return res.body
}
