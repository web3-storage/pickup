import { StackContext, Api, Table, Queue, Bucket, Config } from '@serverless-stack/resources'
import { SSTConstruct } from '@serverless-stack/resources/dist/Construct'
import * as cfnApig from 'aws-cdk-lib/aws-apigatewayv2'
import * as apig from '@aws-cdk/aws-apigatewayv2-alpha'
import * as s3 from 'aws-cdk-lib/aws-s3'
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
        environment: {
          TABLE_NAME: dynamoDbTable.tableName
        },
        permissions: [dynamoDbTable]
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

  const bucket = new Bucket(stack, 'Car', {
    cdk: {
      bucket: s3.Bucket.fromBucketName(stack, 'carpark', process.env.CARPARK ?? 'carpark-staging-0')
    }
  })

  const customDomain = getCustomDomain(app.stage, process.env.HOSTED_ZONE)
  const apiFunctionBindList: SSTConstruct[] = [bucket, dynamoDbTable, queue]
  const apiFunctionEnvironment: Record<string, string> = {
    BUCKET_NAME: bucket.bucketName,
    TABLE_NAME: dynamoDbTable.tableName,
    QUEUE_URL: queue.queueUrl,
    CLUSTER_IPFS_ADDR: process.env.CLUSTER_IPFS_ADDR ?? '',
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
        environment: apiFunctionEnvironment,
        timeout: '31 seconds'
      }
    },
    routes: {
      'GET /pins/{cid}': {
        function: {
          handler: 'basic/get-pin.handler'
        }
      },
      'GET /pins': {
        function: {
          handler: 'basic/get-pins.handler'
        }
      },
      'POST /pins/{cid}': {
        function: {
          handler: 'basic/add-pin.handler'
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
