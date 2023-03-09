import nock from 'nock'
import test from 'ava'
import { nanoid } from 'nanoid'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { createPickup, createSqsPoller } from '../lib/pickup.js'
import { compose } from './_compose.js'
import { prepareCid, verifyMessage, sleep, getMessagesFromSQS, stopPickup } from './_helpers.js'
import { CarFetcher } from '../lib/ipfs.js'
import { S3Uploader } from '../lib/s3.js'

test.before(async t => {
  t.timeout(1000 * 60)
  t.context = { ...(await compose()), ipfsApiUrl: 'http://mockipfs.loc:5001' }
})

test.after(async t => {
  await sleep(5000)
  await t.context.shutDownDockers()
})

test('throw an error if can\'t connect to IPFS', async t => {
  const { createQueue, createBucket, s3 } = t.context
  const queueUrl = await createQueue()
  const bucket = await createBucket()
  const ipfsApiUrl = `https://${nanoid()}:6000`

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' } }),
    carFetcher: new CarFetcher({ ipfsApiUrl, fetchTimeoutMs: 2000 }),
    s3Uploader: new S3Uploader({ s3, bucket })
  })
  await t.throwsAsync(() => pickup.start())
})

test('Process 3 messages concurrently and the last has a timeout', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()
  const validationBucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'success' }),
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'success' }),
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 3000, expectedResult: 'failed' })
  ]

  const ipfsApiUrl = `https://${nanoid()}:6000`
  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .reply(200, 'GC Success').persist()

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

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' } }),
    carFetcher: new CarFetcher({ ipfsApiUrl, fetchTimeoutMs: 2000 }),
    s3Uploader: new S3Uploader({ s3, bucket: validationBucket })
  })

  // The number of the messages resolved, when is max close the test and finalize
  let resolved = 0

  const done = new Promise((resolve, reject) => {
    pickup.on('message', async msg => {
      const message = msg.body
      const index = Number(message.requestid)
      if (cars[index].expectedResult !== 'error') {
        const myBuffer = await cars[index].car.arrayBuffer()

        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(0, 10)))
        await sleep(cars[index].timeBetweenChunks)
        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(10)))
        cars[index].carReadableStream.push(null)
      }
    })

    pickup.on('handled', async msg => {
      try {
        await verifyMessage({ msg, cars, t, bucket: validationBucket, s3 })
        resolved++

        if (resolved === cars.length) {
          await sleep(5)
          const resultMessages = await getMessagesFromSQS({ queueUrl, length: cars.length, sqs })
          t.is(resultMessages, undefined)
          nockPickup.done()
          await stopPickup(pickup)
          resolve()
        }
      } catch (e) {
        reject(e)
      }
    })
    pickup.on('error', reject)
    pickup.on('timeoutReached', reject)
  })

  await pickup.start()

  return done
})

test('Process 1 message that fails and returns in the list', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const bucket = await createBucket()

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, timeBetweenChunks: 500, expectedResult: 'success' })
  ]

  const ipfsApiUrl = `https://${nanoid()}:6000`
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

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' } }),
    carFetcher: new CarFetcher({ ipfsApiUrl, fetchTimeoutMs: 5000 }),
    s3Uploader: new S3Uploader({ s3, bucket })
  })

  // The number of the messages resolved, when is max close the test and finalize
  let rx = 0

  const done = new Promise((resolve, reject) => {
    pickup.on('message', async msg => {
      rx++
      if (rx !== 2) return
      const message = msg.body
      const index = Number(message.requestid)
      if (cars[index].expectedResult !== 'error') {
        const myBuffer = await cars[index].car.arrayBuffer()

        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(0, 10)))
        await sleep(cars[index].timeBetweenChunks)
        cars[index].carReadableStream.push(Buffer.from(myBuffer.slice(10)))
        cars[index].carReadableStream.push(null)
      }
    })

    pickup.on('deleted', async res => {
      const msg = res.msg
      try {
        await verifyMessage({ msg, cars, dynamoClient, dynamoTable, t, bucket, s3 })
        await sleep(5)
        const resultMessages = await getMessagesFromSQS({ queueUrl, length: cars.length, sqs })
        t.is(resultMessages, undefined)

        nockPickup.done()
        await stopPickup(pickup)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    pickup.on('error', reject)
    pickup.on('timeoutReached', reject)
  })

  await pickup.start()

  return done
})
