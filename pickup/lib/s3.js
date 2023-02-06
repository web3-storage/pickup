import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { logger } from './logger.js'

/**
 * Init the S3 uploader
 *
 * @param {import('@aws-sdk/client-s3'.S3Client)} client
 * @param {string} bucket
 * @param {string} key
 * @param {Stream} body
 * @param {string} cid
 * @param {object} downloadError
 * @param {string} downloadError.code
 * @returns {Promise<CompleteMultipartUploadCommandOutput | AbortMultipartUploadCommandOutput>}
 */
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
    if (err.code === 'AbortError' || err.constructor.name === 'AbortError') {
      logger.trace({ err, cid }, 'The abort command was thrown by a ipfs timeout')
      return
    }
    logger.error({ err, code: downloadError.code, cid }, 'S3 upload error')
  })

  return s3Upload.done()
}

/**
 * Create the uploader
 * @param {import('@aws-sdk/client-s3'.S3Client)} client
 * @param {string} bucket
 * @param {string} key
 * @returns {import('@aws-sdk/client-s3'.S3Client)}
 */
export function createS3Uploader ({ client = createS3Client(), bucket, key }) {
  return sendToS3.bind(null, { client, bucket, key })
}

/**
 * Create the S3Client
 *
 * @returns {import('@aws-sdk/client-s3'.S3Client)}
 */
export function createS3Client () {
  // Expects AWS_* ENV vars set.
  return new S3Client({})
}
