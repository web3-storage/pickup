import nock from 'nock'
import test from 'ava'
import { SendMessageCommand } from '@aws-sdk/client-sqs'

import { createConsumer } from '../lib/consumer.js'
import { compose } from './_compose.js'
import { prepareCid, verifyMessage, sleep, getMessagesFromSQS } from './_helpers.js'

test.before(async t => {
  t.timeout(1000 * 60)
  t.context = { ...(await compose()), ipfsApiUrl: 'http://mockipfs.loc:5001' }
})

test.after(async t => {
  await t.context.shutDownDockers()
})

test('throw an error if can\'t connect to IPFS', async t => {
  const { createQueue } = t.context
  const queueUrl = await createQueue()
  await t.throwsAsync(createConsumer({
    ipfsApiUrl: 'http://127.0.0.1',
    queueUrl,
    testMaxRetryTime: 1000,
    testTimeoutMs: 50
  }))
})

test('Process 3 messages concurrently and the last has a timeout', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, ipfsApiUrl, sqs, s3, dynamoClient, dynamoEndpoint, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'success' }),
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'success' }),
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 3000, expectedResult: 'failed' })
  ]

  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .reply(200, 'GC Success')

  cars.forEach((car, index) => {
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
      .reply(200, () => {
        return cars[index].carReadableStream
      })
  })

  // Send the SQS messages in queue
  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  // Create the consumer
  const consumer = await createConsumer(
    {
      ipfsApiUrl,
      queueUrl,
      s3,
      heartbeatInterval: 2,
      visibilityTimeout: 3,
      dynamoEndpoint,
      dynamoTable,
      timeoutFetchMs: 2000
    }
  )

  // The number of the messages resolved, when is max close the test and finalize
  let resolved = 0

  const done = new Promise((resolve, reject) => {
    consumer.on('message_received', async msg => {
      const message = JSON.parse(msg.Body)
      const index = Number(message.requestid)
      if (cars[index].expectedResult !== 'error') {
        const myBuffer = await cars[index].car.arrayBuffer()

        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(0, 10)))
        await sleep(cars[index].timeBetweenChunks)
        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(10)))
        cars[index].carReadableStream.push(null)
      }
    })

    consumer.on('message_processed', async msg => {
      try {
        await verifyMessage({ msg, cars, dynamoClient, dynamoTable, t, bucket, s3 })
        resolved++

        if (resolved === cars.length) {
          await sleep(5)
          const resultMessages = await getMessagesFromSQS({ queueUrl, length: cars.length, sqs })
          t.is(resultMessages, undefined)
          nockPickup.done()
          resolve()
        }
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

test('Process 1 message that fails and returns in the list', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, ipfsApiUrl, sqs, s3, dynamoClient, dynamoEndpoint, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'error' })
  ]

  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .reply(200, 'GC Success')
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .reply(200, 'GC Success')

  cars.forEach((car, index) => {
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
      .reply((uri, requestBody) => [400, 'KO'])
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
      .reply((uri, requestBody) => [200, cars[index].carReadableStream])
  })

  // Send the SQS messages in queue
  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  // Create the consumer
  const consumer = await createConsumer(
    {
      ipfsApiUrl,
      queueUrl,
      s3,
      heartbeatInterval: 2,
      visibilityTimeout: 3,
      dynamoEndpoint,
      dynamoTable,
      timeoutFetchMs: 2000
    }
  )

  // The number of the messages resolved, when is max close the test and finalize
  let resolved = 0

  const done = new Promise((resolve, reject) => {
    consumer.on('message_received', async msg => {
      const message = JSON.parse(msg.Body)
      const index = Number(message.requestid)
      if (cars[index].expectedResult !== 'error') {
        const myBuffer = await cars[index].car.arrayBuffer()

        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(0, 10)))
        await sleep(cars[index].timeBetweenChunks)
        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(10)))
        cars[index].carReadableStream.push(null)
      }
    })

    consumer.on('message_processed', async msg => {
      try {
        await verifyMessage({ msg, cars, dynamoClient, dynamoTable, t, bucket, s3 })
        resolved++

        // The +1 is add to manage the second try
        if (resolved === cars.length + 1) {
          await sleep(5)
          const resultMessages = await getMessagesFromSQS({ queueUrl, length: cars.length, sqs })
          t.is(resultMessages, undefined)

          nockPickup.done()
          resolve()
        }
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

test('Process 3 messages concurrently and the last has an error', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, ipfsApiUrl, sqs, s3, dynamoClient, dynamoEndpoint, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'success' }),
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'success' }),
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'error' })
  ]

  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .reply(200, 'GC Success')
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .reply(200, 'GC Success')

  cars.forEach((car, index) => {
    if (car.expectedResult === 'error') {
      nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
        .reply(400, () => {
          return 'OK'
        })
    }
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
      .reply(200, () => {
        return cars[index].carReadableStream
      })
  })

  // Send the SQS messages in queue
  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  // Create the consumer
  const consumer = await createConsumer(
    {
      ipfsApiUrl,
      queueUrl,
      s3,
      heartbeatInterval: 2,
      visibilityTimeout: 3,
      dynamoEndpoint,
      dynamoTable,
      timeoutFetchMs: 2000
    }
  )

  // The number of the messages resolved, when is max close the test and finalize
  let resolved = 0

  const done = new Promise((resolve, reject) => {
    consumer.on('message_received', async msg => {
      const message = JSON.parse(msg.Body)
      const index = Number(message.requestid)
      if (cars[index].expectedResult !== 'error') {
        const myBuffer = await cars[index].car.arrayBuffer()

        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(0, 10)))
        await sleep(cars[index].timeBetweenChunks)
        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(10)))
        cars[index].carReadableStream.push(null)
      }
    })

    consumer.on('message_processed', async msg => {
      try {
        await verifyMessage({ msg, cars, dynamoClient, dynamoTable, t, bucket, s3 })
        resolved++

        if (resolved === cars.length + 1) {
          await sleep(2000)
          const resultMessages = await getMessagesFromSQS({ queueUrl, length: cars.length, sqs })
          t.is(resultMessages, undefined)
          nockPickup.done()
          resolve()
        }
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
