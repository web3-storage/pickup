import { GetObjectCommand } from '@aws-sdk/client-s3'
import { logger } from './logger.js'
import { parseCid, getCarInfo } from './getCarInfo.js'
import { updatePinStatus } from './dynamo.js'

/**
 * Validate CARs for a SQS messages.
 * @param {import('sqs-consumer').SQSMessage} message
 * @param {Object} opts
 * @param {Function} opts.createS3Uploader
 * @param {import('@aws-sdk/client-s3'.S3Client)} opts.s3
 * @param {import('@aws-sdk/lib-dynamodb'.DynamoDBClient)} opts.dynamo
 * @param {string} opts.dynamoTable
 * @returns {Promise<void>}
 */
export async function validateCar (record, {
  s3,
  dynamo,
  dynamoTable
}) {
  const bucket = record.s3.bucket.name
  const key = record.s3.object.key
  const size = record.s3.object.size

  let carInfo
  let cid

  let errors

  try {
    cid = key.split('/').pop().split('.').shift()
    const cidInfo = parseCid(cid)
    if (cidInfo.errors.length) {
      errors = cidInfo.errors
      throw new Error('Cid not valid')
    }

    const s3Object = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }))

    carInfo = await getCarInfo({ cid, carStream: s3Object.Body })

    if (carInfo.errors.length) {
      errors = carInfo.errors
      throw new Error('Car not valid')
    }

    logger.info({ cid, key }, 'Car valid')

    await updatePinStatus({ dynamo, table: dynamoTable, cid, size, status: 'pinned' })
  } catch (err) {
    logger.error({ err: errors, cid, key }, err.message)
    // This value is stored on dynamo, the slice is required to limit the amount of errors stored.
    const storedErrors = carInfo.errors.slice(0, 2).map(err => ({ cid: err.cid, detail: err.detail }))

    if (cid) {
      await updatePinStatus({ dynamo, table: dynamoTable, cid, status: 'failed', size, error: JSON.stringify(storedErrors) })
    }
  }
}

export async function validateCars (message, context) {
  logger.info({ message }, 'Validate car start')
  const eventBody = JSON.parse(message.Body)
  const records = JSON.parse(eventBody.Message).Records

  for (const record of records) {
    await validateCar(record, context)
  }

  return true
}
