import { GenericContainer, Wait } from 'testcontainers'
import { SQSClient, SendMessageCommand, CreateQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import { Consumer } from 'sqs-consumer'
import test from 'ava'

test.before(async t => {
  t.timeout(1000 * 60)
  // see: https://github.com/softwaremill/elasticmq
  const container = await new GenericContainer('softwaremill/elasticmq-native')
    .withExposedPorts(9324)
    .start()
  t.context.sqs = container
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9324)}`
  t.context.sqsClient = new SQSClient({
    endpoint
  })
  const QueueName = 'TEST_QUEUE'
  await t.context.sqsClient.send(new CreateQueueCommand({
    QueueName,
    Attributes: {
      DelaySeconds: '1',
      MessageRetentionPeriod: '10'
    }
  }))
  const { QueueUrl } = await t.context.sqsClient.send(new GetQueueUrlCommand({ QueueName }))
  t.context.QueueUrl = QueueUrl.replace('9324', container.getMappedPort(9324))
})

test.after.always(async t => {
  await t.context.sqs?.stop()
})

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
        // console.log(message)
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

// builds image and starts container
test.only('Dockerfile', async t => {
  const img = await GenericContainer.fromDockerfile('.').build()
  img.withWaitStrategy(Wait.forLogMessage(`Pickup subscribed to ${t.context.QueueUrl}`))
  await t.throwsAsync(img.start())

  img.withEnv('SQS_QUEUE_URL', t.context.QueueUrl)
  await t.throwsAsync(img.start())

  img.withEnv('GATEWAY_URL', 'test')
  let pickup
  try {
    pickup = await img.start()
    t.pass('Should start container')
  } catch (err) {
    t.fail(err.message || err)
  } finally {
    await pickup?.stop()
  }
})
