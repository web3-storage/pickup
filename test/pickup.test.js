import { DockerComposeEnvironment, Wait } from 'testcontainers'
import { S3Client, CreateBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { unpackStream } from 'ipfs-car/unpack'
import { pickup } from '../plugins/pickup.js'
import { Buffer } from 'buffer'
import test from 'ava'

test.before(async t => {
  t.timeout(1000 * 60)
  // Start local ipfs and minio daemons for testing against.
  const docker = await new DockerComposeEnvironment(new URL('./', import.meta.url), 'docker-compose.yml')
    .withWaitStrategy('ipfs', Wait.forLogMessage('Daemon is ready'))
    .up()
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
  const bucket = 'test-bucket'
  await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  const ipfs = docker.getContainer('ipfs')
  t.context.GATEWAY_URL = `http://${ipfs.getHost()}:${ipfs.getMappedPort(8080)}`
  t.context.bucket = bucket
  t.context.s3 = s3
  t.context.docker = docker
})

test.after.always(async t => {
  await t.context.docker?.down()
})

test('pickup', async t => {
  const s3 = t.context.s3
  const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e' // hello world
  const key = `psa/${cid}.car`
  try {
    await s3.send(new GetObjectCommand({ Bucket: t.context.Bucket, Key: key }))
    t.fail('car should not exist in s3 yet')
  } catch (err) {
    // is ok
  }

  await pickup({ client: s3, GATEWAY_URL: t.context.GATEWAY_URL }, {
    cid,
    bucket: t.context.bucket,
    key,
    origins: [],
    requestid: 'test'
  })

  const res = await s3.send(new GetObjectCommand({ Bucket: t.context.bucket, Key: key }))
  const files = []
  for await (const file of unpackStream(res.Body)) {
    files.push(file)
  }
  t.is(files.length, 1, '1 file in the test CAR')

  const chunks = []
  for await (const chunk of files[0].content()) {
    chunks.push(chunk)
  }
  const buf = Buffer.concat(chunks)
  t.is(buf.toString(), 'hello world', 'expected string in the file')
  t.pass()
})
