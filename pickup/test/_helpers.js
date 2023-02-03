import stream from 'node:stream'
import retry from 'async-retry'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { packToBlob } from 'ipfs-car/pack/blob'
import { MemoryBlockStore } from 'ipfs-car/blockstore/memory'
import Stream from 'stream'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { ReceiveMessageCommand } from '@aws-sdk/client-sqs'

export async function getValueFromDynamo ({ dynamoClient, dynamoTable, cid }) {
  const client = DynamoDBDocumentClient.from(dynamoClient)
  const dynamoCheckDocument = await client.send(new GetCommand({
    TableName: dynamoTable,
    Key: { cid }
  }))

  return dynamoCheckDocument.Item
}

export async function getValueContentFromS3 ({ bucket, key, s3 }) {
  return await s3.send(new GetObjectCommand(
    {
      Bucket: bucket,
      Key: key
    }
  ))
}

export async function getMessagesFromSQS ({ queueUrl, length, sqs }) {
  const result = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: length,
    WaitTimeSeconds: 1
  }))

  return result.Messages
}

export async function prepareCid ({ dynamoClient, dynamoTable, timeBetweenChunks, expectedResult }) {
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

  const client = DynamoDBDocumentClient.from(dynamoClient)
  const pin = {
    cid: root.toV1().toString(),
    status: 'queued',
    created: new Date().toISOString()
  }
  await client.send(new PutCommand({
    TableName: dynamoTable,
    Item: pin
  }))
  // Pin was saved
  const cid = root.toV1().toString()
  return {
    text,
    cid,
    car,
    carReadableStream: new Stream.Readable({
      read (size) {
        return true
      }
    }),
    key: `psa/${cid}.car`,
    timeBetweenChunks,
    expectedResult
  }
}

export async function sleep (ms) {
  return new Promise((resolve) => setTimeout(() => resolve(), ms))
}

export async function verifyMessage ({ msg, cars, dynamoClient, dynamoTable, t, bucket, s3, expectedError }) {
  try {
    const message = JSON.parse(msg.Body)
    const index = Number(message.requestid)
    // If there is a timeout, the dynamo item status should be updated to `failed`
    if (cars[index].expectedResult === 'failed') {
      const item = await getValueFromDynamo({ dynamoClient, dynamoTable, cid: cars[index].cid })
      t.is(item.cid, cars[index].cid)
      t.is(item.status, 'failed')
      t.is(item.error, expectedError)
      t.truthy(item.downloadFailedAt > item.created)
    } else if (cars[index].expectedResult === 'error') {
      // after the first error, the expectedResult of the car is set to success to allow the upload in the next step
      cars[index].expectedResult = 'success'
    } else {
      // If succeed, the s3 file should have the same content of the car generated
      const { cid: msgCid } = message
      t.is(msgCid, cars[index].cid)

      const file = await getValueContentFromS3({ bucket, key: cars[index].key, s3 })
      t.is(
        await file.Body.transformToString(),
        Buffer.from(await cars[index].car.arrayBuffer()).toString()
      )
    }
  } catch (err) {
    console.error('verifyMessage ERROR', err)
    throw err
  }
}

export async function stopConsumer (consumer) {
  consumer.stop()
  return await retry(() => !consumer.isRunning, {
    retries: 5
  })
}
