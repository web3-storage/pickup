import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export async function sendToS3 ({ client, bucket, key }, { body }) {
  const params = {
    Metadata: { structure: 'complete' },
    Bucket: bucket,
    Key: key,
    Body: body
  }
  // Handles s3 multipart uploading
  // see: https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md
  const s3Upload = new Upload({ client, params })
  return s3Upload.done()
}

export function createS3Uploader ({ client = createS3Client(), bucket, key }) {
  return sendToS3.bind(null, { client, bucket, key })
}
export function createS3Client () {
  // Expects AWS_* ENV vars set.
  return new S3Client({})
}
