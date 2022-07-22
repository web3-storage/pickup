import { DockerComposeEnvironment, Wait } from 'testcontainers'
import { SQSClient, CreateQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { nanoid, customAlphabet } from 'nanoid'

export async function up () {
  return await new DockerComposeEnvironment(new URL('./', import.meta.url), 'docker-compose.yml')
    .withWaitStrategy('ipfs', Wait.forLogMessage('Daemon is ready'))
    .withNoRecreate()
    .up()
}

export async function compose () {
  const docker = await up()
  const minio = docker.getContainer('minio')
  const s3 = new S3Client({
    endpoint: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin'
    }
  })

  const sqsContainer = docker.getContainer('sqs')
  const sqs = new SQSClient({
    endpoint: `http://${sqsContainer.getHost()}:${sqsContainer.getMappedPort(9324)}`
  })

  const ipfs = docker.getContainer('ipfs')
  const ipfsApiUrl = `http://${ipfs.getHost()}:${ipfs.getMappedPort(5001)}`
  return {
    s3,
    sqs,
    createQueue: createQueue.bind(null, sqsContainer.getMappedPort(9324), sqs),
    createBucket: createBucket.bind(null, s3),
    ipfsApiUrl
  }
}

export async function createQueue (sqsPort, sqs) {
  const QueueName = nanoid()
  await sqs.send(new CreateQueueCommand({
    QueueName,
    Attributes: {
      DelaySeconds: '1',
      MessageRetentionPeriod: '10'
    }
  }))
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName }))
  return QueueUrl.replace('9324', sqsPort)
}

export async function createBucket (s3) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const Bucket = id()
  await s3.send(new CreateBucketCommand({ Bucket }))
  return Bucket
}
