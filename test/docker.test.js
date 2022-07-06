import { GenericContainer, Wait } from 'testcontainers'
import test from 'ava'

// builds image and starts container
test('build', async t => {
  const queueUrl = 'http://127.0.0.1'
  const img = await GenericContainer.fromDockerfile('.').build()
  img.withWaitStrategy(Wait.forLogMessage(`Pickup subscribed to ${queueUrl}`))
  await t.throwsAsync(img.start())

  img.withEnv('SQS_QUEUE_URL', queueUrl)
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
