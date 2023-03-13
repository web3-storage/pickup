import { StackContext, Api, Table, Queue, Bucket, Topic, Config } from '@serverless-stack/resources'
import { SSTConstruct } from '@serverless-stack/resources/dist/Construct'
import * as cfnApig from 'aws-cdk-lib/aws-apigatewayv2'
import * as apig from '@aws-cdk/aws-apigatewayv2-alpha'
import { Duration } from 'aws-cdk-lib'

export function BasicApiStack ({
  app,
  stack
}: StackContext): { queue: Queue, bucket: Bucket, dynamoDbTable: Table } {
  const dynamoDbTable = new Table(stack, 'BasicV2', {
    fields: {
      cid: 'string'
    },
    primaryIndex: {
      partitionKey: 'cid'
    }
  })

  const dlq = new Queue(stack, 'PinDlq', {
    cdk: {
      queue: {
        visibilityTimeout: Duration.seconds(40) // should be greater than the lambda timeout
      }
    },
    consumer: {
      function: {
        timeout: '30 seconds',
        handler: 'basic/fail-pin.sqsPinQueueDeadLetterHandler',
        functionName: formatResourceName(app.stage, 'failPin'),
        environment: {
          TABLE_NAME: dynamoDbTable.tableName
        }
      },
      cdk: {
        eventSource: {
          reportBatchItemFailures: true,
          batchSize: 10,
          maxBatchingWindow: Duration.seconds(10)
        }
      }
    }
  })

  const queue = new Queue(stack, 'Pin', {
    cdk: {
      queue: {
        deadLetterQueue: {
          queue: dlq.cdk.queue,
          maxReceiveCount: 3
        }
      }
    }
  })

  const updatePinDlq = new Queue(stack, 'UpdatePinDlq')
  const consumer = process.env.USE_VALIDATION !== 'VALIDATE'
    ? {
        function: {
          handler: 'basic/update-pin.sqsEventHandler',
          functionName: formatResourceName(app.stage, 'updatePin'),
          bind: [dynamoDbTable],
          environment: {
            TABLE_NAME: dynamoDbTable.tableName
          }
        },
        cdk: {
          eventSource: {
            batchSize: 1
          }
        }
      }
    : undefined

  const updatePinQueue = new Queue(stack, 'UpdatePinQueue', {
    consumer,
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
      updatePinQueue
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
  bucket.cdk.bucket.enableEventBridgeNotification()

  const customDomain = getCustomDomain(app.stage, process.env.HOSTED_ZONE)
  const apiFunctionBindList: SSTConstruct[] = [bucket, dynamoDbTable, queue]
  const apiFunctionEnvironment: Record<string, string> = {
    BUCKET_NAME: bucket.bucketName,
    TABLE_NAME: dynamoDbTable.tableName,
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
      'GET    /pins/{cid}': {
        function: {
          handler: 'basic/get-pin-router.handler',
          functionName: formatResourceName(app.stage, 'getPinRouter'),
          timeout: '31 seconds'
        }
      },
      'GET    /pins': {
        function: {
          handler: 'basic/get-pins-router.handler',
          functionName: formatResourceName(app.stage, 'getPinsRouter'),
          timeout: '31 seconds'
        }
      },
      'POST   /pins/{cid}': {
        function: {
          handler: 'basic/add-pin-router.handler',
          functionName: formatResourceName(app.stage, 'postPinRouter'),
          timeout: '31 seconds'
        }
      },
      'GET    /internal/pins/{cid}': {
        function: {
          handler: 'basic/get-pin.handler',
          functionName: formatResourceName(app.stage, 'getPin')
        }
      },
      'GET    /internal/pins': {
        function: {
          handler: 'basic/get-pins.handler',
          functionName: formatResourceName(app.stage, 'getPins')
        }
      },
      'POST   /internal/pins/{cid}': {
        function: {
          handler: 'basic/add-pin.handler',
          functionName: formatResourceName(app.stage, 'postPin')
        }
      }
    }
    // adding a 404 default route handler means CORS OPTION not work without extra config.
  })
  const defaultStage = api.cdk.httpApi.defaultStage as apig.HttpStage
  const cfnDefaultStage = defaultStage.node.defaultChild as cfnApig.CfnStage
  cfnDefaultStage.defaultRouteSettings = {
    ...cfnDefaultStage.defaultRouteSettings,
    detailedMetricsEnabled: true
  }

  stack.addOutputs({
    S3EventsTopicARN: s3Topic.topicArn,
    ApiEndpoint: api.url,
    CustomDomain: (customDomain !== undefined) ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })

  return {
    queue,
    bucket,
    dynamoDbTable
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

function formatResourceName (stage: string, name: string): string {
  return `${stage}-pickup-${name}`
}
