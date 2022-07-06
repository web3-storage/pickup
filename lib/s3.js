import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export function createS3Client ({ AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION }) {
  const client = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY
    }
  })
  return client
}

export function toBucketKey ({ cid, userId, appName }) {
  return `psa/${appName}-${userId}/${cid}.car`
}

export async function sendToS3 ({ client, bucket, NODE_ENV }, { body, key }) {
  const params = {
    Metadata: { structure: 'complete' },
    Key: key,
    Bucket: bucket,
    Body: body
  }
  // see: https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md
  const s3Upload = new Upload({ client, params })
  // if (NODE_ENV !== 'production') {
  //   s3Upload.on('httpUploadProgress', (progress) => {
  //     console.log(progress)
  //   })
  // }
  await s3Upload.done()
}
