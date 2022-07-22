import { GenericContainer, Wait } from 'testcontainers'
import test from 'ava'

// builds image and starts container
test('build', async t => {
  t.timeout(1000 * 120)
  const SQS_QUEUE_URL = 'http://127.0.0.1'
  const IPFS_API_URL = 'http://127.0.0.1:5001'
  const img = await GenericContainer.fromDockerfile(new URL('../', import.meta.url).pathname).build()
  img.withWaitStrategy(Wait.forLogMessage('Pickup starting...'))
  await t.throwsAsync(img.start())

  // set all the things it needs
  img.withEnv('IPFS_API_URL', IPFS_API_URL)
  img.withEnv('SQS_QUEUE_URL', SQS_QUEUE_URL)

  let pickup
  try {
    pickup = await img.start()
    t.teardown(() => pickup.stop())
    t.pass('Should start container')
  } catch (err) {
    t.fail(err.message || err)
  }
})
