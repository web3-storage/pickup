import { StackContext, Api, Table, Queue, Bucket, Topic, Config } from '@serverless-stack/resources'
import { SSTConstruct } from '@serverless-stack/resources/dist/Construct'
import { ApiGatewayV2Client, UpdateStageCommand } from '@aws-sdk/client-apigatewayv2'

export function BasicApiStack ({ app, stack }: StackContext): { queue: Queue, bucket: Bucket } {
  const dlq = new Queue(stack, 'PinDlq')

  const queue = new Queue(stack, 'Pin', {
    cdk: {
      queue: {
        deadLetterQueue: {
          queue: dlq.cdk.queue,
          maxReceiveCount: 2
        }
      }
    }
  })

  const table = new Table(stack, 'BasicV2', {
    fields: {
      cid: 'string'
    },
    primaryIndex: {
      partitionKey: 'cid'
    }
  })

  const updatePinDlq = new Queue(stack, 'UpdatePinDlq')
  const updatePinQueue = new Queue(stack, 'UpdatePinQueue', {
    consumer: {
      function: {
        handler: 'basic/update-pin.sqsEventHandler',
        bind: [table],
        environment: {
          TABLE_NAME: table.tableName
        }
      },
      cdk: {
        eventSource: {
          batchSize: 1
        }
      }
    },
    cdk: {
      queue: {
        deadLetterQueue: {
          queue: updatePinDlq.cdk.queue,
          maxReceiveCount: 2
        }
      }
    }
  })
  const s3Topic = new Topic(stack, 'S3Events', {
    subscribers: {
      updatePinQueue: updatePinQueue
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
  const apiFunctionBindList: SSTConstruct[] = [bucket, table, queue]
  const apiFunctionEnvironment: Record<string, string> = {
    BUCKET_NAME: bucket.bucketName,
    TABLE_NAME: table.tableName,
    QUEUE_URL: queue.queueUrl,
    CLUSTER_IPFS_ADDR: process.env.CLUSTER_IPFS_ADDR ?? '',
    LEGACY_CLUSTER_IPFS_URL: process.env.LEGACY_CLUSTER_IPFS_URL ?? '',
    PICKUP_URL: (customDomain !== undefined) ? `https://${customDomain.domainName}` : '',
    BALANCER_RATE: process.env.BALANCER_RATE ?? '100',
    LOG_LEVEL: process.env.LAMBDA_LOG_LEVEL ?? 'info'
  }
  const AUTH_TOKEN = new Config.Secret(stack, 'AUTH_TOKEN')
  configureAuth(apiFunctionBindList, apiFunctionEnvironment, AUTH_TOKEN)

  const api = new Api(stack, 'api', {
    customDomain,
    cors: true,
    defaults: {
      function: {
        bind: apiFunctionBindList,
        environment: apiFunctionEnvironment
      }
    },
    routes: {
      'GET    /pins/{cid}': 'basic/get-pin-router.handler',
      'POST   /pins/{cid}': 'basic/add-pin-router.handler',
      'GET    /internal/pins/{cid}': 'basic/get-pin.handler',
      'POST   /internal/pins/{cid}': 'basic/add-pin.handler'
    }
    // adding a 404 default route handler means CORS OPTION not work without extra config.
  })

  const apiGatewayClient = new ApiGatewayV2Client({ region: app.region })
  const updateCmd = new UpdateStageCommand({
    ApiId: api.httpApiId,
    StageName: '$default',
    DefaultRouteSettings: {
      DetailedMetricsEnabled: true
    }
  })

  apiGatewayClient.send(updateCmd).then((data) => {
    console.log('Successfully updated API stage')
    console.log(data.DefaultRouteSettings)
  }).catch((error) => {
    console.log('Failed to update API stage')
    console.log(error)
  })

  stack.addOutputs({
    S3EventsTopicARN: s3Topic.topicArn,
    ApiEndpoint: api.url,
    HttpApiId: api.httpApiId,
    CustomDomain: (customDomain !== undefined) ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })

  return {
    queue,
    bucket
  }
}

function configureAuth (apiFunctionBindList: SSTConstruct[], apiFunctionEnvironment: Record<string, string>, AUTH_TOKEN: Config.Secret): void {
  if (process.env.CLUSTER_BASIC_AUTH_TOKEN == null) {
    apiFunctionBindList.push(AUTH_TOKEN)
  } else {
    apiFunctionEnvironment.CLUSTER_BASIC_AUTH_TOKEN = process.env.CLUSTER_BASIC_AUTH_TOKEN
  }
}

function getCustomDomain (stage: string, hostedZone?: string): { domainName: string, hostedZone: string } | undefined {
  if (hostedZone === undefined) {
    return undefined
  }
  const domainName = stage === 'prod' ? hostedZone : `${stage}.${hostedZone}`
  return { domainName, hostedZone }
}
