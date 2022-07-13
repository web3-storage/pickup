import { GenericContainer, Wait, Network } from 'testcontainers'
import test from 'ava'

// builds image and starts container
test.skip('build', async t => {
  t.timeout(1000 * 120)
  const SQS_QUEUE_URL = 'http://127.0.0.1'
  const network = await new Network().start()
  t.teardown(() => network.stop())
  const ipfsHost = 'ipfs'
  const ipfs = await new GenericContainer('ipfs/go-ipfs:v0.13.0')
    .withNetworkAliases(ipfsHost)
    .withExposedPorts(5001)
    .withNetworkMode(network.getName())
    .start()
  t.teardown(() => ipfs.stop())
  const ipfsApiUrl = `http://${ipfsHost}:5001`
  const img = await GenericContainer.fromDockerfile(new URL('../..', import.meta.url).pathname).build()
  img.withWaitStrategy(Wait.forLogMessage(`Pickup subscribed to ${SQS_QUEUE_URL}`))
  img.withNetworkMode(network.getName()) // so it can talk to the go-ipfs node
  await t.throwsAsync(img.start())

  // set all the things it needs
  img.withEnv('IPFS_API_URL', ipfsApiUrl)
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
