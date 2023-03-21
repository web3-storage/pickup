import nock from 'nock'
import test from 'ava'
import { nanoid } from 'nanoid'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { createPickup, createSqsPoller } from '../lib/pickup.js'
import { compose } from './_compose.js'
import { prepareCid, verifyMessage, sleep, getMessagesFromSQS, stopPickup } from './_helpers.js'
import { CarFetcher } from '../lib/ipfs.js'
import { S3Uploader } from '../lib/s3.js'
import { PinTable } from '../lib/dynamo.js'

test.before(async t => {
  t.timeout(1000 * 60)
  t.context = { ...(await compose()), ipfsApiUrl: 'http://mockipfs.loc:5001' }
})

test.after(async t => {
  await sleep(5000)
  await t.context.shutDownDockers()
})

test('add delegates to a pin record', async t => {
  const { dynamoTable, dynamoEndpoint } = t.context
  const pinTable = new PinTable({
    table: dynamoTable,
    endpoint: dynamoEndpoint
  })
  const cid = 'foo'
  const delegates = new Set(['/ip4/test'])
  await pinTable.addDelegates({ cid, delegates })
  const pin = await pinTable.getPin({ cid })
  // verify it adds delegates
  t.is(pin.cid, cid)
  t.deepEqual(pin.delegates, delegates)

  // verify that it appends additional delegates
  const nextDelegate = new Set(['/ip4/next'])
  await pinTable.addDelegates({ cid, delegates: nextDelegate })
  const pin2 = await pinTable.getPin({ cid })
  t.is(pin2.cid, cid)
  t.deepEqual(pin2.delegates, new Set([...nextDelegate, ...delegates]))
})

test('throw an error if can\'t connect to IPFS', async t => {
  const { createQueue, createBucket, s3 } = t.context
  const queueUrl = await createQueue()
  const destinationBucket = await createBucket()
  const validationBucket = await createBucket()
  const ipfsApiUrl = `https://${nanoid()}:6000`

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' } }),
    carFetcher: new CarFetcher({ ipfsApiUrl }),
    s3Uploader: new S3Uploader({ s3, destinationBucket, validationBucket })
  })
  await t.throwsAsync(() => pickup.start())
})

test('Process 1 message successfully', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const destinationBucket = await createBucket()
  const validationBucket = await createBucket()
  const ipfsApiUrl = `https://${nanoid()}:6000`

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' }, maxInFlight: 1, activePollIntervalMs: 10000 }),
    carFetcher: new CarFetcher({ ipfsApiUrl, fetchTimeoutMs: 1000, fetchChunkTimeoutMs: 1000 }),
    s3Uploader: new S3Uploader({ s3, validationBucket, destinationBucket })
  })

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, expectedResult: 'success' })
  ]

  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .optionally().reply(200, 'GC Success').persist()

  for (const item of cars) {
    const buf = Buffer.from(await item.car.arrayBuffer())
    nockPickup.post(`/api/v0/dag/export?arg=${item.cid}`).reply(200, buf)
  }

  // Send the SQS messages in queue
  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket: destinationBucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  let msgCount = 0
  let msgDel = 0

  const done = new Promise((resolve, reject) => {
    const nope = (reason) => {
      stopPickup(pickup)
      t.fail(reason)
      reject(new Error(reason))
    }
    pickup.on('message', () => msgCount++)
    pickup.on('released', () => nope('unexpected released event'))
    pickup.on('error', () => nope('unexpected error event'))
    pickup.on('timeoutReached', () => nope('unexpected timeoutReached event'))
    pickup.on('deleted', () => {
      msgDel++
      t.is(msgCount, 1)
      t.is(msgDel, 1)
      try {
        stopPickup(pickup)
        nockPickup.done()
        resolve()
      } catch (err) {
        console.log('error', err)
        reject(err)
      }
    })
  })

  await pickup.start()

  return done
})

test('Fail 1 message that sends data but exceeds fetchTimeoutMs', async t => {
  t.timeout(1000 * 60 * 2)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const destinationBucket = await createBucket()
  const validationBucket = await createBucket()
  const ipfsApiUrl = `https://${nanoid()}:6000`

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' }, maxInFlight: 1, activePollIntervalMs: 10000, idlePollIntervalMs: 10000 }),
    carFetcher: new CarFetcher({ ipfsApiUrl, fetchTimeoutMs: 500, fetchChunkTimeoutMs: 2000 }),
    s3Uploader: new S3Uploader({ s3, validationBucket, destinationBucket })
  })

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, expectedResult: 'failed' })
  ]

  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .optionally().reply(200, 'GC Success').persist()

  cars.forEach((car, index) => {
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
      .reply(200, () => {
        return cars[index].carReadableStream // we would write to this stream, but we want the test to fail
      })
  })

  // Send the SQS messages in queue
  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket: destinationBucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  let msgReleased = 0

  const done = new Promise((resolve, reject) => {
    const nope = (reason) => {
      stopPickup(pickup)
      t.fail(reason)
      reject(new Error(reason))
    }
    pickup.on('released', () => {
      msgReleased++
      t.is(msgReleased, 1)
      try {
        stopPickup(pickup)
        nockPickup.done()
        resolve()
      } catch (err) {
        console.log('error', err)
        reject(err)
      }
    })
    pickup.on('error', () => nope('unexpected error event'))
    pickup.on('timeoutReached', () => nope('unexpected timeoutReached event'))
    pickup.on('deleted', () => nope('unexpected deleted event'))
  })

  await pickup.start()

  return done
})

test('Fail 1 message that sends data but exceeds fetchChunkTimeoutMs', async t => {
  t.timeout(1000 * 60 * 2)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const destinationBucket = await createBucket()
  const validationBucket = await createBucket()
  const ipfsApiUrl = `https://${nanoid()}:6000`

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' }, maxInFlight: 1, activePollIntervalMs: 10000, idlePollIntervalMs: 10000 }),
    carFetcher: new CarFetcher({ ipfsApiUrl, fetchTimeoutMs: 2000, fetchChunkTimeoutMs: 1000 }),
    s3Uploader: new S3Uploader({ s3, validationBucket, destinationBucket })
  })

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, expectedResult: 'failed' })
  ]

  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .optionally().reply(200, 'GC Success').persist()

  cars.forEach((car, index) => {
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
      .reply(200, () => {
        return cars[index].carReadableStream // we would write to this stream, but we want the test to fail
      })
  })

  // Send the SQS messages in queue
  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket: destinationBucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  let msgReleased = 0

  const done = new Promise((resolve, reject) => {
    const nope = (reason) => {
      stopPickup(pickup)
      t.fail(reason)
      reject(new Error(reason))
    }
    pickup.on('released', () => {
      msgReleased++
      t.is(msgReleased, 1)
      try {
        stopPickup(pickup)
        nockPickup.done()
        resolve()
      } catch (err) {
        console.log('error', err)
        reject(err)
      }
    })
    pickup.on('error', () => nope('unexpected error event'))
    pickup.on('timeoutReached', () => nope('unexpected timeoutReached event'))
    pickup.on('deleted', () => nope('unexpected deleted event'))
  })

  await pickup.start()

  return done
})

test('Fail 1 message that sends data but exceeds maxCarBytes', async t => {
  t.timeout(1000 * 60 * 2)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const destinationBucket = await createBucket()
  const validationBucket = await createBucket()
  const ipfsApiUrl = `https://${nanoid()}:6000`

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' }, maxInFlight: 1, activePollIntervalMs: 10000, idlePollIntervalMs: 10000 }),
    carFetcher: new CarFetcher({ ipfsApiUrl, maxCarBytes: 1 }),
    s3Uploader: new S3Uploader({ s3, validationBucket, destinationBucket })
  })

  // Preapre the data for the test
  const cars = [
    await prepareCid({ dynamoClient, dynamoTable, expectedResult: 'failed' })
  ]

  // Configure nock to mock the response
  const nockPickup = nock(ipfsApiUrl)
  nockPickup
    .post('/api/v0/id')// Alive
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')// Garbage collector
    .optionally().reply(200, 'GC Success').persist()

  cars.forEach((car, index) => {
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`) // Get pin
      .reply(200, () => {
        return cars[index].car
      })
  })

  // Send the SQS messages in queue
  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket: destinationBucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  let msgReleased = 0

  const done = new Promise((resolve, reject) => {
    const nope = (reason) => {
      stopPickup(pickup)
      t.fail(reason)
      reject(new Error(reason))
    }
    pickup.on('released', () => {
      msgReleased++
      t.is(msgReleased, 1)
      try {
        stopPickup(pickup)
        nockPickup.done()
        resolve()
      } catch (err) {
        console.log('error', err)
        reject(err)
      }
    })
    pickup.on('error', () => nope('unexpected error event'))
    pickup.on('timeoutReached', () => nope('unexpected timeoutReached event'))
    pickup.on('deleted', () => nope('unexpected deleted event'))
  })

  await pickup.start()

  return done
})

test('Process 3 messages concurrently and the last has a timeout', async t => {
  t.timeout(1000 * 60 * 2)
  const { createQueue, createBucket, sqs, s3, dynamoClient, dynamoTable } = t.context

  const queueUrl = await createQueue()
  const destinationBucket = await createBucket()
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
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket: destinationBucket, key: cars[i].key, origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  const pickup = createPickup({
    sqsPoller: createSqsPoller({ queueUrl, awsConfig: { region: 'us-east-1' } }),
    carFetcher: new CarFetcher({ ipfsApiUrl, fetchChunkTimeoutMs: 2000 }),
    s3Uploader: new S3Uploader({ s3, validationBucket, destinationBucket })
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
