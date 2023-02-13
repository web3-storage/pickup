import test from 'ava'
import { SendMessageCommand } from '@aws-sdk/client-sqs'

import { createConsumer } from '../lib/consumer.js'
import { compose } from './_compose.js'
import {
  prepareCid,
  getMessage,
  sleep,
  stopConsumer,
  getValueFromDynamo, getValueContentFromS3
} from './_helpers.js'

test.before(async t => {
  t.timeout(1000 * 60)
  t.context = await compose()
})

test.after(async t => {
  await sleep(5000)
  await t.context.shutDownDockers()
})

test('Process 1 message and fails due an unexpected end of data', async t => {
  t.timeout(1000 * 60)
  t.plan(6)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoEndpoint, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()
  const validationBucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, s3, bucket: validationBucket, errorType: 'cut' })
  ]

  await sqs.send(new SendMessageCommand({
    MessageBody: getMessage(bucket, cars[0].cid, cars[0].size),
    QueueUrl: queueUrl
  }))

  // Create the consumer
  const consumer = await createConsumer(
    {
      queueUrl,
      s3,
      heartbeatInterval: 2,
      visibilityTimeout: 3,
      dynamoEndpoint,
      dynamoTable,
      timeoutFetchMs: 2000,
      validationBucket
    }
  )

  const done = new Promise((resolve, reject) => {
    consumer.on('message_received', async msg => {
    })

    consumer.on('message_processed', async msg => {
      try {
        const item = await getValueFromDynamo({ dynamoClient, dynamoTable, cid: cars[0].cid })
        t.is(item.error, `[{"cid":"${cars[0].cid}","detail":"Unexpected end of data"}]`)
        t.is(item.status, 'failed')
        t.is(item.size, cars[0].size)
        t.truthy(item.validatedAt > item.created)

        try {
          await getValueContentFromS3({ bucket, key: cars[0].key, s3 })
        } catch (e) {
          t.is(e.message, 'The specified key does not exist.')
        }

        const validationFile = await getValueContentFromS3({ bucket: validationBucket, key: cars[0].key, s3 })
        t.truthy(
          await validationFile.Body.transformToString()
        )

        await stopConsumer(consumer)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    consumer.on('processing_error', reject)
    consumer.on('timeout_error', reject)
  })

  consumer.start()

  return done
})

test('Process 1 message and fails due a CBOR decode error', async t => {
  t.timeout(1000 * 60)
  t.plan(6)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoEndpoint, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()
  const validationBucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, s3, bucket: validationBucket, errorType: 'invalid' })
  ]

  await sqs.send(new SendMessageCommand({
    MessageBody: getMessage(bucket, cars[0].cid, cars[0].size),
    QueueUrl: queueUrl
  }))

  // Create the consumer
  const consumer = await createConsumer(
    {
      queueUrl,
      s3,
      heartbeatInterval: 2,
      visibilityTimeout: 3,
      dynamoEndpoint,
      dynamoTable,
      timeoutFetchMs: 2000,
      validationBucket
    }
  )

  const done = new Promise((resolve, reject) => {
    consumer.on('message_received', async msg => {
    })

    consumer.on('message_processed', async msg => {
      try {
        const item = await getValueFromDynamo({ dynamoClient, dynamoTable, cid: cars[0].cid })
        t.is(item.error, `[{"cid":"${cars[0].cid}","detail":"CBOR decode error: non-string keys not supported (got number)"}]`)
        t.is(item.status, 'failed')
        t.is(item.size, cars[0].size)
        t.truthy(item.validatedAt > item.created)

        try {
          await getValueContentFromS3({ bucket, key: cars[0].key, s3 })
        } catch (e) {
          t.is(e.message, 'The specified key does not exist.')
        }

        const validationFile = await getValueContentFromS3({ bucket: validationBucket, key: cars[0].key, s3 })
        t.truthy(
          await validationFile.Body.transformToString()
        )

        await stopConsumer(consumer)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    consumer.on('processing_error', reject)
    consumer.on('timeout_error', reject)
  })

  consumer.start()

  return done
})

test('Process 1 message and succeed', async t => {
  t.timeout(1000 * 60)
  t.plan(6)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoEndpoint, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()
  const validationBucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, s3, bucket: validationBucket, errorType: 'none' })
  ]

  await sqs.send(new SendMessageCommand({
    MessageBody: getMessage(bucket, cars[0].cid, cars[0].size),
    QueueUrl: queueUrl
  }))

  // Create the consumer
  const consumer = await createConsumer(
    {
      queueUrl,
      s3,
      heartbeatInterval: 2,
      visibilityTimeout: 3,
      dynamoEndpoint,
      dynamoTable,
      timeoutFetchMs: 2000,
      validationBucket
    }
  )

  const done = new Promise((resolve, reject) => {
    consumer.on('message_received', async msg => {
    })

    consumer.on('message_processed', async msg => {
      try {
        const item = await getValueFromDynamo({ dynamoClient, dynamoTable, cid: cars[0].cid })
        t.is(item.status, 'pinned')
        t.is(item.size, cars[0].size)
        t.truthy(item.validatedAt > item.created)
        t.falsy(item.error)

        try {
          await getValueContentFromS3({ bucket: validationBucket, key: cars[0].key, s3 })
        } catch (e) {
          t.is(e.message, 'The specified key does not exist.')
        }

        const file = await getValueContentFromS3({ bucket, key: cars[0].key, s3 })
        t.is(
          await file.Body.transformToString(),
          Buffer.from(await cars[0].car.arrayBuffer()).toString()
        )

        await stopConsumer(consumer)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    consumer.on('processing_error', reject)
    consumer.on('timeout_error', reject)
  })

  consumer.start()

  return done
})
