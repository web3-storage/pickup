import { StackContext, Api, Table, Queue, Bucket, Topic } from '@serverless-stack/resources'
import * as sns from 'aws-cdk-lib/aws-sns'

export function BasicApiStack ({ stack }: StackContext): { queue: Queue, bucket: Bucket } {
  const indexerTopicArn = process.env.INDEXER_TOPIC_ARN
  if (indexerTopicArn === undefined) {
    console.warn('INDEXER_TOPIC_ARN is not set, creating local sns topic')
  }

  const indexerTopic = new Topic(stack, 'IndexerTopic', {
    cdk: {
      // the indexer sns topic is managed elsewhere so we import it by ARN here.
      topic: indexerTopicArn !== undefined ? sns.Topic.fromTopicArn(stack, 'IndexerTopic', indexerTopicArn) : undefined
    }
  })

  const bucket = new Bucket(stack, 'Car', {
    notifications: {
      indexer: {
        type: 'topic',
        topic: indexerTopic,
        events: ['object_created']
      }
    }
  })

  const queue = new Queue(stack, 'Pin')

  const table = new Table(stack, 'BasicV2', {
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
          QUEUE_URL: queue.queueUrl,
          CLUSTER_BASIC_AUTH_TOKEN: process.env.CLUSTER_BASIC_AUTH_TOKEN ?? ''
        }
      }
    },
    routes: {
      'GET    /pins/{cid}': 'basic/get-pin.handler',
      'POST   /pins/{cid}': 'basic/add-pin.handler'
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
