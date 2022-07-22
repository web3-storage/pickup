import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { Consumer } from 'sqs-consumer'
import { createConsumer } from '../lib/consumer.js'
import { compose } from './_compose.js'
import test from 'ava'

test.before(async t => {
  t.timeout(1000 * 60)
  t.context = await compose()
})

// verify the lib behaves as expected
test('sqs-consumer', async t => {
  const testCid = 'hello!'
  const { sqs, createQueue } = t.context

  const QueueUrl = await createQueue()
  await sqs.send(new SendMessageCommand({
    DelaySeconds: 1,
    MessageBody: JSON.stringify({ cid: testCid }),
    QueueUrl
  }))

  await new Promise((resolve, reject) => {
    const app = Consumer.create({
      queueUrl: QueueUrl,
      handleMessage: async (message) => {
        const res = JSON.parse(message.Body)
        t.is(res.cid, testCid)
        app.stop()
        resolve(true)
      }
    })
    app.on('error', (err) => {
      reject(err)
    })
    app.on('processing_error', (err) => {
      reject(err)
    })
    app.on('timeout_error', (err) => {
      reject(err)
    })
    app.start()
  })
})

test('createConsumer', async t => {
  t.timeout(1000 * 60)
  const { createQueue, createBucket, ipfsApiUrl, sqs, s3 } = t.context

  const cid = 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'
  const key = `psa/${cid}.car`
  const queueUrl = await createQueue()
  const bucket = await createBucket()
  const consumer = await createConsumer({ ipfsApiUrl, queueUrl, s3 })
  const done = new Promise((resolve, reject) => {
    consumer.on('message_processed', msg => {
      const { cid: msgCid } = JSON.parse(msg.Body)
      t.is(msgCid, cid)
      resolve()
    })
    consumer.on('processing_error', reject)
    consumer.on('timeout_error', reject)
  })
  consumer.start()

  await sqs.send(new SendMessageCommand({
    DelaySeconds: 1,
    MessageBody: JSON.stringify({ cid, bucket, key, origins: [], requestid: 'test1' }),
    QueueUrl: queueUrl
  }))

  return done
})

test('createConsumer errors if can\'t connect to IPFS', async t => {
  const { createQueue } = t.context
  const queueUrl = await createQueue()
  await t.throwsAsync(createConsumer({ ipfsApiUrl: 'http://127.0.0.1', queueUrl }))
})
