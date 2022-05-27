import fastifyEnv from '@fastify/env'
import pins from './routes/pins.js'
import s3 from './plugins/s3.js'

const envSchema = {
  type: 'object',
  required: ['PORT', 'NODE_ENV', 'GATEWAY_URL', 'S3_BUCKET_NAME', 'S3_BUCKET_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY_ID'],
  properties: {
    PORT: { type: 'string', default: 3000 },
    NODE_ENV: { type: 'string', default: 'dev' },
    GATEWAY_URL: { type: 'string' },
    S3_BUCKET_NAME: { type: 'string' },
    S3_BUCKET_REGION: { type: 'string' },
    S3_ACCESS_KEY_ID: { type: 'string' },
    S3_SECRET_ACCESS_KEY_ID: { type: 'string' }
  }
}

export default async function plugin (fastify, opts) {
  await fastify.register(fastifyEnv, { dotenv: true, schema: envSchema, confKey: 'env' })
  await fastify.register(s3)
  await fastify.register(pins)
}
