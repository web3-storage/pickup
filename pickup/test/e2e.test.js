import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import stream from 'node:stream'
import { packToBlob } from 'ipfs-car/pack/blob'
import { MemoryBlockStore } from 'ipfs-car/blockstore/memory'
import { createConsumer } from '../lib/consumer.js'
import { compose } from './_compose.js'
import nock from 'nock'
import Stream from 'stream'

import test from 'ava'

async function prepareCid ({dynamoClient, dynamoTable}) {
  const text = (Math.random() + 1).toString(36)
  const writable = new stream.Writable({
    write: function (chunk, encoding, next) {
      next()
    }
  })
  // const writable = fs.createWriteStream(`${process.cwd()}/output.car`)
  const { root, car } = await packToBlob({
    input: Buffer.from(text),
    writable,
    blockstore: new MemoryBlockStore(),
    wrapWithDirectory: false // Wraps input into a directory. Defaults to `true`
  })

  const client = DynamoDBDocumentClient.from(dynamoClient)
  const pin = {
    cid: root.toV1().toString(),
    status: 'queued',
    created: new Date().toISOString()
  }
  console.log({
    TableName: dynamoTable,
    Item: pin
  })
  await client.send(new PutCommand({
    TableName: dynamoTable,
    Item: pin
  }))
    // Pin was saved
  return {
    text,
    cid: root.toV1().toString(),
    car
  }
}

test.before(async t => {
  t.timeout(1000 * 60)
  t.context = { ...(await compose()), ipfsApiUrl: 'http://mockipfs.loc:5001' }
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

test('createConsumer', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, ipfsApiUrl, sqs, s3, dynamoClient, dynamoEndpoint, dynamoTable } = t.context

  const cars = [
    await prepareCid({dynamoClient, dynamoTable}),
    await prepareCid({dynamoClient, dynamoTable}),
    await prepareCid({dynamoClient, dynamoTable})
    // await prepareCid(),
  ]

  const readableStreams = cars.map(() => new Stream.Readable({
    read (size) {
      return true
    }
  }))

  const nockPickup = nock(ipfsApiUrl)

  nockPickup
    .post('/api/v0/id')
    .reply(200, JSON.stringify({ AgentVersion: 'Agent 1', ID: '12345465' }))
    .post('/api/v0/repo/gc?silent=true')
    .reply(200, 'GC Success')

  cars.forEach((car, index) => {
    nockPickup.post(`/api/v0/dag/export?arg=${car.cid}`)
      .reply(200, () => {
        return readableStreams[index]
      })
  })

  const keys = cars.map((car) => `psa/${car.cid}.car`)

  const queueUrl = await createQueue()
  const bucket = await createBucket()

  for (let i = 0; i < cars.length; i++) {
    await sqs.send(new SendMessageCommand({
      MessageBody: JSON.stringify({ cid: cars[i].cid, bucket, key: keys[i], origins: [], requestid: i }),
      QueueUrl: queueUrl
    }))
  }

  const consumer = await createConsumer(
    {
      ipfsApiUrl,
      queueUrl,
      s3,
      heartbeatInterval: 4,
      dynamoEndpoint,
      dynamoTable
    }
  )

  let resolved = 0

  const done = new Promise((resolve, reject) => {
    consumer.on('message_received', async msg => {
      const message = JSON.parse(msg.Body)
      console.log('TEST: message_received', message.requestid)
      const index = Number(message.requestid)
      const myBuffer = await cars[index].car.arrayBuffer()
      readableStreams[index].push(Buffer.from(myBuffer.slice(0, 10)))
      if (index > 1) {
        await new Promise((resolve) => setTimeout(() => resolve(), 5000))
      }
      readableStreams[index].push(Buffer.from(myBuffer.slice(10)))
      readableStreams[index].push(null)
    })
    consumer.on('response_processed', async msg => {
      console.log('TEST: response_processed')
      msg && console.log(msg)
    })
    consumer.on('message_processed', async msg => {
      // msg && msg.Body && console.log(msg.Body)

      const message = JSON.parse(msg.Body)
      console.log('TEST: message_processed', message.requestid)
      const index = Number(message.requestid)
      if (index > 1) {
        const client = DynamoDBDocumentClient.from(dynamoClient)
        const dynamoCheckDocument = await client.send(new GetCommand({
          TableName: dynamoTable,
          Key: { cid: cars[index].cid }
        }))
        t.is(dynamoCheckDocument.Item.cid, cars[index].cid)
        t.is(dynamoCheckDocument.Item.status, 'failed')
      } else {
        const { cid: msgCid } = message
        t.is(msgCid, cars[index].cid)
        const file = await s3.send(new GetObjectCommand(
          {
            Bucket: bucket,
            Key: keys[index]
          }
        ))
        t.is(
          await file.Body.transformToString(),
          Buffer.from(await cars[index].car.arrayBuffer()).toString()
        )
      }
      resolved++
      if (resolved === cars.length) { resolve() }
    })
    consumer.on('processing_error', async msg => {
      console.log('TEST: processing_error')
      msg && console.log(msg)
      reject()
    })
    consumer.on('timeout_error', async msg => {
      console.log('TEST: timeout_error')
      msg && console.log(msg)
      reject()
    })
  })
  consumer.start()

  return done
})
