import { GetObjectCommand } from '@aws-sdk/client-s3'
import { logger } from './logger.js'
import { parseCid, parseCar } from './parsers.js'
import { updatePinStatus } from './dynamo.js'

/**
 * Validate a CAR record.
 * @param {import('sqs-consumer').SQSMessage} message
 * @param {Object} opts
 * @param {Function} opts.createS3Uploader
 * @param {import('@aws-sdk/client-s3'.S3Client)} opts.s3
 * @param {import('@aws-sdk/lib-dynamodb'.DynamoDBClient)} opts.dynamo
 * @param {string} opts.dynamoTable
 * @returns {Promise<void>}
 */
export async function validateCar (record, {
  s3
}) {
  const bucket = record.s3.bucket.name
  const key = record.s3.object.key
  const size = record.s3.object.size

  let validationCarResult
  let cid

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

    logger.info({ cid, key }, 'Car valid')

    return { cid, key, size }
  } catch (err) {
    logger.error({ cid, key, err }, 'Validation car exception')
    return { cid, key, size, errors: { cid, detail: err.message } }
  }
}

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
    }
  }

  return true
}
