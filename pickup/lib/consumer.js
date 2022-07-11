import { Consumer } from 'sqs-consumer'
import { createS3Uploader } from './s3.js'
import { testIpfsApi } from './ipfs.js'
import { pickup } from './pickup.js'

export async function createConsumer ({ ipfsApiUrl, queueUrl }) {
  await testIpfsApi(ipfsApiUrl) // throws if can't connect

  const app = Consumer.create({
    queueUrl,
    handleMessage: async (message) => {
      const { cid, origins, bucket, key/*, resquestid */ } = JSON.parse(message.Body)
      await pickup({
        upload: createS3Uploader({ bucket, key }),
        ipfsApiUrl,
        origins,
        cid
      })
    }
  })

  app.on('error', (err) => {
    console.error(err.message)
  })

  app.on('processing_error', (err) => {
    console.error(err.message)
  })

  return app
}
