import { S3Client, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import retry from 'p-retry'
import { linkdex } from './car.js'
import { logger } from './logger.js'

/**
 * Upload CAR stream to temp bucket, verify it, then copy to destination bucket
 *
 * @param {object} config
 * @param {S3Client} config.client
 * @param {string} config.validationBucket
 * @param {string} config.destinationBucket
 * @param {string} config.key
 * @param {Readable} config.body
 * @param {string} config.cid
 */
export async function uploadAndVerify ({ client, validationBucket, destinationBucket, key, body, cid }) {
  // Handles s3 multipart uploading
  // see: https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md
  const s3Upload = new Upload({
    client,
    params: {
      Metadata: { structure: 'complete' },
      Bucket: validationBucket,
      Key: key,
      Body: body
    }
  })

  await s3Upload.done()

  await checkCar({ client, bucket: validationBucket, key, cid })

  return retry(() => client.send(new CopyObjectCommand({
    CopySource: `${validationBucket}/${key}`,
    Bucket: destinationBucket,
    Key: key
  })), { retries: 5, onFailedAttempt: (err) => logger.info({ err, cid }, 'Copy to destination failed, retrying') })
}

/**
 * Fetch the car and stream it through linkdex to check if it's complete
 *
 * @param {object} config
 * @param {S3Client} config.client
 * @param {string} config.bucket
 * @param {string} config.key
 * @param {string} config.cid
 */
export async function checkCar ({ client, bucket, key, cid }) {
  let report
  try {
    report = await retry(async () => {
      const res = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key
      }))
      return linkdex(res.Body)
    }, { retries: 3, onFailedAttempt: (err) => logger.info({ err, cid }, 'checkCar failed, retrying') })
  } catch (cause) {
    throw new Error('checkCar failed', { cause })
  }

  if (report.blocksIndexed === 0) {
    logger.info({ report, cid }, 'linkdex: Empty CAR')
    throw new Error('Empty CAR')
  }

  if (report.structure !== 'Complete') {
    logger.info({ report, cid }, 'linkdex: DAG not complete')
    throw new Error('DAG not complete')
  }
}

export class S3Uploader {
  /**
   * @param {object} config
   * @param {S3Client} s3
   * @param {string} validationBucket
   * @param {string} destinationBucket
   */
  constructor ({ s3 = new S3Client(), validationBucket, destinationBucket }) {
    this.s3 = s3
    this.validationBucket = validationBucket
    this.destinationBucket = destinationBucket
  }

  /**
   * @param {object} config
   * @param {string} cid
   * @param {string} key
   */
  createUploader ({ cid, key }) {
    const { s3, validationBucket, destinationBucket } = this
    /**
     * @typedef {import('node:stream').Readable} Readable
     * @param {Readable} body
     */
    return async function (body) {
      return uploadAndVerify({
        client: s3,
        validationBucket,
        destinationBucket,
        key,
        body,
        cid
      })
    }
  }
}
