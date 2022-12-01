import { StackContext, Api, Table, Queue, Bucket, Topic } from '@serverless-stack/resources'

export function BasicApiStack ({ app, stack }: StackContext): { queue: Queue, bucket: Bucket } {
  const queue = new Queue(stack, 'Pin')

  const table = new Table(stack, 'BasicV2', {
    fields: {
      cid: 'string'
    },
    primaryIndex: {
      partitionKey: 'cid'
    }
  })

  const s3Topic = new Topic(stack, 'S3Events', {
    subscribers: {
      updatePin: {
        function: {
          handler: 'basic/update-pin.snsEventHandler',
          permissions: [table],
          environment: {
            TABLE_NAME: table.tableName
          }
        }
      }
    }
  })

  const bucket = new Bucket(stack, 'Car', {
    notifications: {
      topic: {
        type: 'topic',
        topic: s3Topic,
        events: ['object_created']
      }
    }
  })

  const customDomain = getCustomDomain(app.stage, process.env.HOSTED_ZONE)

  const api = new Api(stack, 'api', {
    customDomain,
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

  stack.addOutputs({
    S3EventsTopicARN: s3Topic.topicArn,
    ApiEndpoint: api.url,
    CustomDomain: (customDomain !== undefined) ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })

  return {
    queue,
    bucket
  }
}

function getCustomDomain (stage: string, hostedZone?: string): { domainName: string, hostedZone: string} | undefined {
  if (hostedZone === undefined) {
    return undefined
  }
  const domainName = stage === 'prod' ? hostedZone : `${stage}.${hostedZone}`
  return { domainName, hostedZone }
}
