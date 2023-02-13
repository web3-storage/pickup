import { GetObjectCommand } from '@aws-sdk/client-s3'
import { logger } from './logger.js'
import { parseCid, parseCar } from './parsers.js'
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
export async function validateCar (record, { s3, validationBucket }) {
  const bucket = validationBucket
  const key = record.s3.object.key
  const size = record.s3.object.size

  let validationCarResult
  let cid

  logger.info({ key, bucket: record.s3.bucket.name, validationBucket }, 'Try to validate')
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

    validationCarResult = await parseCar({ cid, carStream: s3Object.Body })

    if (validationCarResult.errors.length) {
      return { cid, key, size, errors: validationCarResult.errors }
    }

    logger.info({ cid, key, bucket }, 'Car valid')
    await copyFile({ client: s3, sourceBucket: validationBucket, destinationBucket: record.s3.bucket.name, key })

    logger.info({ cid, key, bucket, validationBucket }, 'Car copied from validation bucket')

    return { cid, key, size }
  } catch (err) {
    console.log(err)
    logger.error({ cid, key, err }, 'Validation car exception')
    return { cid, key, size, errors: { cid, detail: err.message } }
  }
}

/**
 * Process the CARs
 *
 * @param {import('sqs-consumer').SQSMessage} message
 * @param {import('@aws-sdk/lib-dynamodb'.DynamoDBClient)} context.dynamo
 * @param {string} context.dynamoTable
 * @param {string} context.validationBucket
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

      await removeFile({ client: context.s3, bucket: context.validationBucket, key })
    }
  }

  return true
}
