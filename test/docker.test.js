import { GenericContainer, Wait } from 'testcontainers'
import test from 'ava'

// builds image and starts container
test('build', async t => {
  t.timeout(1000 * 120)
  const SQS_QUEUE_URL = 'http://127.0.0.1'
  const IPFS_API_URL = 'http://127.0.0.1:5001'
  const DYNAMO_TABLE_NAME = 'test-table'
  const DYNAMO_DB_ENDPOINT = 'http://127.0.0.1:9000'
  const img = await GenericContainer.fromDockerfile(new URL('../', import.meta.url).pathname)
    .build()
  // In case the test fails comment this and uncomment the log snippet
  img.withWaitStrategy(Wait.forLogMessage('Pickup starting...'))
  // -----------------------------------------------------------------
  await t.throwsAsync(img.start())

  // set all the things it needs
  img.withEnv('IPFS_API_URL', IPFS_API_URL)
  img.withEnv('SQS_QUEUE_URL', SQS_QUEUE_URL)
  img.withEnv('DYNAMO_TABLE_NAME', DYNAMO_TABLE_NAME)
  img.withEnv('DYNAMO_DB_ENDPOINT', DYNAMO_DB_ENDPOINT)

  let pickup
  try {
    pickup = await img.start()

    // In case the test fails uncomment this to verify the logs of the container
    //
    // const stream = await pickup.logs();
    // stream
    //   .on("data", line => console.log(line))
    //   .on("err", line => console.error(line))
    //   .on("end", () => console.log("Stream closed"));
    // await new Promise(resolve => setTimeout(resolve, 5000))
    // -----------------------------------------------------------------

    t.teardown(() => pickup.stop())
    t.pass('Should start container')
  } catch (err) {
    t.fail(err.message || err)
  }
})
