import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { logger } from './logger.js'

export async function sendToS3 ({ client, bucket, key }, { body, cid, downloadError }) {
  const params = {
    Metadata: { structure: 'complete' },
    Bucket: bucket,
    Key: key,
    Body: body
  }

  // Handles s3 multipart uploading
  // see: https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md
  const s3Upload = new Upload({ client, params })

  body.on('error', (err) => {
    logger.error({ err, code: downloadError.code }, 'S3 upload error')
  })

  return s3Upload.done()
}

export function createS3Uploader ({ client = createS3Client(), bucket, key }) {
  return sendToS3.bind(null, { client, bucket, key })
}
export function createS3Client () {
  // Expects AWS_* ENV vars set.
  return new S3Client({})
}
