import { S3Client, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import retry from 'p-retry'
import { linkdex } from './car.js'
import { logger } from './logger'

/**
 * Upload CAR stream to temp bucket, verify it, then copy to destination bucket
 *
 * @param {import('@aws-sdk/client-s3'.S3Client)} client
 * @param {string} bucket
 * @param {string} key
 * @param {Readable} body
 * @param {string} cid
 */
export async function uploadAndVerify ({ client, bucket, destinationBucket, key, body, cid }) {
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

  await s3Upload.done()

  await checkCar({ client, bucket, key, cid })

  return retry(() => client.send(new CopyObjectCommand({
    CopySource: `${sourceBucket}/${key}`,
    Bucket: destinationBucket,
    Key: key
  })))
}

export async function checkCar ({ client, bucket, key, cid }) {
  let report
  try {
    report = await retry(async () => {
      const res = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key
      }))
      return linkdex(res.body)
    })
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
      return uploadAndVerify({
        client: s3,
        bucket,
        key,
        body,
        cid
      })
    }
  }
}
