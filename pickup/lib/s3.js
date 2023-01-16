import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

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

  s3Upload.on('httpUploadProgress', (progress) => {
    console.log('Progress', progress)
  })

  body.on('error', (err) => {
    console.log('err', err.message)
    if (downloadError.code) {
      console.log('Error by timeout')
    }
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
