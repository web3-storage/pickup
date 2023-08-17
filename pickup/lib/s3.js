import { S3Client, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import retry from 'p-retry'
import { checkCar } from './car.js'
import { logger } from './logger.js'

/**
 * Verify CAR, by getting it back from the verification bucket and checking the dag is complete.
 * If it's ok, calculate it's size and carCid and copy to destination bucket
 *
 * @param {object} config
 * @param {S3Client} config.client
 * @param {string} config.validationBucket
 * @param {string} config.destinationBucket
 * @param {string} config.key
 * @param {string} config.cid
 */
export async function verify ({ client, validationBucket, destinationBucket, key, cid }) {
  const res = await retry(() => client.send(new GetObjectCommand({
    Bucket: validationBucket,
    Key: key
  })), { retries: 5, onFailedAttempt: (err) => logger.info({ err, cid }, 'Get car from s3 failed, retrying') })

  let check
  try {
    check = await checkCar(res.Body)
  } catch (err) {
    logger.info({ err, cid }, 'checkCar failed')
    throw new Error('checkCar failed', { cause: err })
  }

  const { carCid, carSize, report } = check

  if (report.blocksIndexed === 0) {
    logger.info({ report, cid }, 'linkdex: Empty CAR')
    throw new Error('Empty CAR')
  }

  if (report.structure !== 'Complete') {
    logger.info({ report, cid }, 'linkdex: DAG not complete')
    throw new Error('DAG not complete')
  }

  await retry(() => client.send(new CopyObjectCommand({
    CopySource: `${validationBucket}/${key}`,
    Bucket: destinationBucket,
    Key: `${carCid}/${carCid}.car`
  })), { retries: 5, onFailedAttempt: (err) => logger.info({ err, cid }, 'Copy to destination failed, retrying') })

  return { carCid, carSize, cid }
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
     * @param {AbortSignal} signal
     */
    return async function (body, signal) {
      // Handles s3 multipart uploading
      // see: https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md
      const s3Upload = new Upload({
        client: s3,
        params: {
          Metadata: { structure: 'Complete' },
          Bucket: validationBucket,
          Key: key,
          Body: body
        }
      })
      signal.addEventListener('abort', () => s3Upload.abort())
      await s3Upload.done()

      return verify({ client: s3, validationBucket, destinationBucket, key, cid })
    }
  }
}
