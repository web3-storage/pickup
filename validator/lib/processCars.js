import { GetObjectCommand } from '@aws-sdk/client-s3'
import { logger } from './logger.js'
import { parseCid, checkForCompleteDag } from './validators.js'
import { updatePinStatus } from './dynamo.js'
import { copyFile, removeFile } from './s3.js'

/**
 * Validate a CAR record.
 *
 * @param {Object} record
 * @param {string} record.s3.bucket.name
 * @param {string} record.s3.object.key
 * @param {number} record.s3.object.size
 * @param {import('@aws-sdk/client-s3'.S3Client)} s3
 * @returns {Promise<void>}
 */
export async function validateCar (record, { s3, destinationBucket }) {
  const bucket = record.s3.bucket.name
  const key = record.s3.object.key
  const size = record.s3.object.size

  let cid

  logger.info({ key, validationBucket: record.s3.bucket.name, destinationBucket }, 'Try to validate')
  try {
    cid = key.split('/').pop().split('.').shift()
    const ValidationCidResult = parseCid(cid)
    if (ValidationCidResult.errors.length) {
      return { cid, key, size, errors: ValidationCidResult.errors }
    }

    const s3Object = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }))

    const { structure, blocksIndexed } = await checkForCompleteDag(s3Object.Body)

    if (blocksIndexed === 0) {
      throw new Error('empty CAR, zero blocks found')
    }

    if (structure !== 'Complete') {
      throw new Error(`Structure not complete: ${structure}, blocks: ${blocksIndexed}`)
    }

    logger.info({ cid, key, validationBucket: record.s3.bucket.name }, 'Car valid')
    await copyFile({ client: s3, sourceBucket: record.s3.bucket.name, destinationBucket, key })

    logger.info({
      cid,
      key,
      validationBucket: record.s3.bucket.name,
      destinationBucket
    }, 'Car copied from validation bucket')

    return { cid, key, size }
  } catch (err) {
    logger.error({ cid, key, err }, 'Validation car exception')
    return { cid, key, size, errors: [{ cid, detail: err.message }] }
  }
}

/**
 * Process the CARs
 *
 * @param {import('sqs-consumer').SQSMessage} message
 * @param {import('@aws-sdk/lib-dynamodb'.DynamoDBClient)} context.dynamo
 * @param {string} context.dynamoTable
 * @param {string} context.destinationBucket
 * @returns {Promise<boolean>}
 */
export async function processCars (message, context) {
  logger.info({ message }, 'Validate car start')
  const eventBody = JSON.parse(message.Body)
  const records = JSON.parse(eventBody.Message).Records

  for (const record of records) {
    const { errors, cid, key, size } = await validateCar(record, context)

    if (errors?.length) {
      logger.error({ err: errors, cid, key }, errors[0].message)
      if (cid) {
        await updatePinStatus({
          dynamo: context.dynamo,
          table: context.dynamoTable,
          cid,
          status: 'failed',
          size,
          // This value is stored on dynamo, the slice is required to limit the amount of errors stored.
          error: JSON.stringify(errors.slice(0, 2).map(err => ({ cid: err.cid, detail: err.detail })))
        })
      }
    } else {
      await updatePinStatus({
        dynamo: context.dynamo,
        table: context.dynamoTable,
        cid,
        size,
        status: 'pinned'
      })

      await removeFile({ client: context.s3, bucket: record.s3.bucket.name, key })
    }
  }

  return true
}
