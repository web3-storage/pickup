import { StackContext, Api, Table, Queue, Bucket } from '@serverless-stack/resources'

export function ApiStack ({ stack }: StackContext): { queue: Queue, bucket: Bucket } {
  const queue = new Queue(stack, 'Pin')

  const bucket = new Bucket(stack, 'Car')

  const table = new Table(stack, 'BasicV1', {
    fields: {
      cid: 'string'
    },
    primaryIndex: {
      partitionKey: 'cid'
    }
  })

  const api = new Api(stack, 'api', {
    cors: true,
    defaults: {
      function: {
        permissions: [table, queue], // Allow the API to access the table and topic
        environment: {
          BUCKET_NAME: bucket.bucketName,
          TABLE_NAME: table.tableName,
          QUEUE_URL: queue.queueUrl
        }
      }
    },
    routes: {
      'GET    /pins/{cid}': 'functions/basic/get-pin.handler',
      'POST   /pins/{cid}': 'functions/basic/add-pin.handler'
    }
    // adding a 404 default route handler means CORS OPTION not work without extra config.
  })

  // Show the endpoint in the output
  stack.addOutputs({
    ApiEndpoint: api.url,
    QueueURL: queue.queueUrl
  })

  return {
    queue,
    bucket
  }
}
