import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import fastifyPlugin from 'fastify-plugin'

export default fastifyPlugin(async function (fastify, opts) {
  // Make available as `fastify.s3` and `fastify.sendToS3` globals
  const client = createS3Client(fastify.env)
  const bucket = fastify.env.S3_BUCKET_NAME
  fastify.decorate('s3', client)
  fastify.decorate('sendToS3', sendToS3.bind(this, { client, bucket, NODE_ENV: fastify.env.NODE_ENV }))
})

export function createS3Client ({ S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY_ID, S3_BUCKET_REGION, NODE_ENV }) {
  console.log('NODE_ENV', NODE_ENV)
  const client = new S3Client({
    region: S3_BUCKET_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY_ID
    }
  })
  if (NODE_ENV !== 'production') {
    client.middlewareStack.add(
      (next) => async (args) => {
        console.log('s3 request headers', args.request.headers)
        return next(args)
      },
      { step: 'finalizeRequest' }
    )
  }
  return client
}

export async function sendToS3 ({ client, bucket, NODE_ENV }, { body, cid, userId = 'testUser', appName = 'testApp' }) {
  const params = {
    Metadata: { structure: 'complete' },
    Key: `psa/${appName}-${userId}/${cid}.car`,
    Bucket: bucket,
    Body: body
  }
  // see: https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md
  const s3Upload = new Upload({ client, params })
  if (NODE_ENV !== 'production') {
    s3Upload.on('httpUploadProgress', (progress) => {
      console.log(progress)
    })
  }
  await s3Upload.done()
}
