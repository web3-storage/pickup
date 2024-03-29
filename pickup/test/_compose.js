import { DockerComposeEnvironment } from 'testcontainers'
import { SQSClient, CreateQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { nanoid, customAlphabet } from 'nanoid'
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb'

export async function up () {
  return await new DockerComposeEnvironment(new URL('./', import.meta.url), 'docker-compose.yml')
    .up()
}

export async function compose () {
  const docker = await up()
  const s3Container = docker.getContainer('minio')
  const s3 = new S3Client({
    endpoint: `http://${s3Container.getHost()}:${s3Container.getMappedPort(9000)}`,
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

  const dynamoDbContainer = docker.getContainer('dynamoDb')

  const dynamoTable = nanoid()
  const dynamoEndpoint = `http://${dynamoDbContainer.getHost()}:${dynamoDbContainer.getMappedPort(8000)}`
  const dynamoClient = new DynamoDBClient({
    endpoint: dynamoEndpoint
  })

  await dynamoClient.send(new CreateTableCommand({
    TableName: dynamoTable,
    AttributeDefinitions: [
      { AttributeName: 'cid', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'cid', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))

  return {
    s3,
    sqs,
    createQueue: createQueue.bind(null, sqsContainer.getMappedPort(9324), sqs),
    createBucket: createBucket.bind(null, s3),
    ipfsApiUrl,
    dynamoEndpoint,
    dynamoClient,
    dynamoTable,
    sqsContainer,
    shutDownDockers: () => docker.down()
  }
}

export async function createQueue (sqsPort, sqs) {
  const QueueName = nanoid()
  await sqs.send(new CreateQueueCommand({
    QueueName,
    Attributes: {
      DelaySeconds: '0',
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
