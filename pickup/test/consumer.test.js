import { GenericContainer } from 'testcontainers'
import { SQSClient, SendMessageCommand, CreateQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import { Consumer } from 'sqs-consumer'
import { createConsumer } from '../lib/consumer.js'
import test from 'ava'

test.before(async t => {
  t.timeout(1000 * 60)
  const container = await new GenericContainer('softwaremill/elasticmq-native') // see: https://github.com/softwaremill/elasticmq
    .withExposedPorts(9324)
    .start()
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9324)}`
  const sqsClient = new SQSClient({ endpoint })
  const QueueName = 'TEST_QUEUE'
  await sqsClient.send(new CreateQueueCommand({
    QueueName,
    Attributes: {
      DelaySeconds: '1',
      MessageRetentionPeriod: '10'
    }
  }))
  const { QueueUrl } = await sqsClient.send(new GetQueueUrlCommand({ QueueName }))
  t.context.QueueUrl = QueueUrl.replace('9324', container.getMappedPort(9324))
  t.context.sqsClient = sqsClient
  t.context.sqs = container
})

test.after.always(async t => {
  await t.context.sqs?.stop()
})

// verify the lib behaves as expected
test('sqs-consumer', async t => {
  const testCid = 'hello!'

  await t.context.sqsClient.send(new SendMessageCommand({
    DelaySeconds: 1,
    MessageBody: JSON.stringify({ cid: testCid }),
    QueueUrl: t.context.QueueUrl
  }))

  await new Promise((resolve, reject) => {
    const app = Consumer.create({
      queueUrl: t.context.QueueUrl,
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
  const queueUrl = t.context.QueueUrl
  const ipfs = await new GenericContainer('ipfs/go-ipfs:v0.13.0').withExposedPorts(5001).start()
  t.teardown(() => ipfs.stop())
  const ipfsApiUrl = `http://${ipfs.getHost()}:${ipfs.getMappedPort(5001)}`
  await t.notThrowsAsync(createConsumer({ ipfsApiUrl, queueUrl }))
})

test('createConsumer errors if can\'t connect to IPFS', async t => {
  const queueUrl = t.context.QueueUrl
  const ipfsApiUrl = 'http://127.0.0.1'
  await t.throwsAsync(createConsumer({ ipfsApiUrl, queueUrl }))
})
