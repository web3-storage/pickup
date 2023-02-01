import stream from 'node:stream'
import retry from 'async-retry'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { packToBlob } from 'ipfs-car/pack/blob'
import { MemoryBlockStore } from 'ipfs-car/blockstore/memory'
import { PutObjectCommand } from '@aws-sdk/client-s3'

export async function getValueFromDynamo ({ dynamoClient, dynamoTable, cid }) {
  const client = DynamoDBDocumentClient.from(dynamoClient)
  const dynamoCheckDocument = await client.send(new GetCommand({
    TableName: dynamoTable,
    Key: { cid }
  }))

  return dynamoCheckDocument.Item
}

export async function prepareCid ({ dynamoClient, dynamoTable, s3, bucket, errorType }) {
  const text = (Math.random() + 1).toString(36)
  const writable = new stream.Writable({
    write: function (chunk, encoding, next) {
      next()
    }
  })
  const { root, car } = await packToBlob({
    input: Buffer.from(text),
    writable,
    blockstore: new MemoryBlockStore(),
    wrapWithDirectory: false // Wraps input into a directory. Defaults to `true`
  })

  const carBuffer = await car.arrayBuffer()

  const client = DynamoDBDocumentClient.from(dynamoClient)
  const cid = root.toV1().toString()
  const pin = {
    cid,
    status: 'queued',
    created: new Date().toISOString()
  }
  await client.send(new PutCommand({
    TableName: dynamoTable,
    Item: pin
  }))
  // Pin was saved

  const key = `pickup/${cid}/${cid}.root.car`
  let body = Buffer.from(carBuffer)
  if (errorType === 'cut') {
    body = Buffer.from(carBuffer.slice(0, 10))
  } else if (errorType === 'invalid') {
    body = body.toString().substring(0, body.length - 3) + '  '
  }
  await s3.send(new PutObjectCommand(
    {
      Bucket: bucket,
      Key: key,
      Body: body
    }
  ))

  return {
    text,
    cid,
    car,
    size: body.length,
    key
  }
}

export async function sleep (ms) {
  return new Promise((resolve) => setTimeout(() => resolve(), ms))
}

export async function stopConsumer (consumer) {
  consumer.stop()
  return await retry(() => !consumer.isRunning, {
    retries: 5
  })
}

export function getMessage (bucket, cid, size) {
  const record = {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'us-west-2',
        eventTime: (new Date()).toISOString(),
        eventName: 'ObjectCreated:Put',
        userIdentity: {
          principalId: 'AWS:AROAXLN6VFMMS2DGKJLTE:9cbf105722d14f218ee127e3837f1385'
        },
        requestParameters: {
          sourceIPAddress: '10.0.130.0'
        },
        responseElements: {
          'x-amz-request-id': '59CSNF6BCZH75PHZ',
          'x-amz-id-2': 'wAmeC+A02xdmyw2SFwVZZ2t4bw8COaa73xYP60nfv1i1leHlkzJdELQFO5KXD11799Iu126rzqOA13DDjWsq4UwhC2conb+m'
        },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'ZTlhODU0NDgtNzFiMS00Y2I2LWIzNzItYzM3N2Q4ZGRiYTIx',
          bucket: {
            name: bucket,
            ownerIdentity: {
              principalId: 'AYO4WEHS71BT1'
            },
            arn: `arn:aws:s3:::${bucket}`
          },
          object: {
            key: `pickup/${cid}/${cid}.root.car`,
            size: size,
            eTag: 'b332b4be7796d2e85ef52b730860d5a5',
            sequencer: '0063D8E181C54F5A1F'
          }
        }
      }
    ]
  }
  return JSON.stringify({
    Type: 'Notification',
    MessageId: 'a9216f98-1ddc-514a-827f-33cafe1e4064',
    TopicArn: 'arn:aws:sns:us-west-2:505595374361:pr83-pickup-S3Events',
    Subject: 'Amazon S3 Notification',
    Message: JSON.stringify(record),
    Timestamp: (new Date()).toISOString(),
    SignatureVersion: '1',
    Signature: 'CVwaToUgLIKYEWwBcix2kAZBdoQjRrkD5LhvtHGONkxpTl51g7OYGlWuK0KpkiY+yIAnffAvVE275AATvVNKQYw9cZYgcnp7BfwTQoGXIdmo+kvMpIamB7QDZ1PEr3iS9sA29S5NPlbLagRsfbcglR4+AnLqEzPzG7wF5/nE94MHYOHMrCXUS8YXh6EQ6vexqXS3pIN6T8QR+y82qYpVqjpLJ0XyOx5q/2xNcAie9HQzRbIAYw6HFa0R6kBkhOcvznGA3OQ8rI9lvYPZnkNMUxPwS4+lJST0/OB9H1HxkdOcrA3Ni4CGfbyd/i/sFpQ6NGLgrH8tjYjPnPJwA3cLTg==',
    SigningCertURL: 'https://sns.us-west-2.amazonaws.com/SimpleNotificationService-56e67fcb41f6fec09b0196692625d385.pem',
    UnsubscribeURL: 'https://sns.us-west-2.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-west-2:505595374361:pr83-pickup-S3Events:e0f0b3af-39f7-4720-ad9b-49b7b8efe397'
  })
}
