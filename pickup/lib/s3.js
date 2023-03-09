import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { logger } from './logger.js'

/**
 * Init the S3 uploader
 *
 * @param {import('@aws-sdk/client-s3'.S3Client)} client
 * @param {string} bucket
 * @param {string} key
 * @param {Readable} body
 * @param {string} cid
 * @returns {Promise<CompleteMultipartUploadCommandOutput | AbortMultipartUploadCommandOutput>}
 */
export async function sendToS3 ({ client, bucket, key, body, cid }) {
  // Handles s3 multipart uploading
  // see: https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md
  const s3Upload = new Upload({
    client,
    params: {
      Metadata: { structure: 'complete' },
      Bucket: bucket,
      Key: key,
      Body: body
    }
  })

  body.on('error', (error) => {
    if (error.code === 'AbortError' || error.constructor.name === 'AbortError') {
      logger.trace({ error, cid }, 'The abort command was thrown by a ipfs timeout')
      return
    }
    logger.error({ error, cid }, 'S3 upload error')
  })

  return s3Upload.done()
}

/**
 * Create the uploader
 * @param {import('@aws-sdk/client-s3'.S3Client)} client
 * @param {string} bucket
 * @returns {import('@aws-sdk/client-s3'.S3Client)}
 */
export function createS3Uploader ({ client = createS3Client(), bucket }) {
  return function (key) {
    sendToS3()
  }
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

export class S3Uploader {
  /**
   * @param {object} config
   * @param {S3Client} s3
   * @param {string} bucket
   */
  constructor ({ s3 = new S3Client(), bucket }) {
    this.s3 = s3
    this.bucket = bucket
  }

  /**
   * @param {object} config
   * @param {string} cid
   * @param {string} key
   */
  createUploader ({ cid, key }) {
    const { s3, bucket } = this
    /**
     * @typedef {import('node:stream').Readable} Readable
     * @param {Readable} body
     */
    return async function (body) {
      return sendToS3({
        client: s3,
        bucket,
        key,
        body,
        cid
      })
    }
  }
}
