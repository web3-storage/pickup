import { StackContext, use, Queue, Bucket, Table, Topic } from '@serverless-stack/resources'
import { BasicApiStack } from './BasicApiStack'
import { Cluster, ContainerImage, LogDrivers, Secret, FirelensLogRouterType, LogDriver, PropagatedTagSource } from 'aws-cdk-lib/aws-ecs'
import { Platform } from 'aws-cdk-lib/aws-ecr-assets'
import { QueueProcessingFargateService, QueueProcessingFargateServiceProps } from './lib/queue-processing-fargate-service'
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam'
import { Duration, aws_ssm } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'

type MutableQueueProcessingFargateServiceProps = { // The same object without readonly
  -readonly [key in keyof QueueProcessingFargateServiceProps]: QueueProcessingFargateServiceProps[key];
}

export function PickupStack ({ app, stack }: StackContext): void {
  const basicApi = use(BasicApiStack) as unknown as { queue: Queue, bucket: Bucket, dynamoDbTable: Table }
  const cluster = new Cluster(stack, 'ipfs', {
    containerInsights: true
  })
  // Network calls to S3 and dynamodb through internal network
  createVPCGateways(cluster.vpc)

  const validationBucket = new Bucket(stack, 'ValidationCar', {
    cdk: {
      bucket: {
        lifecycleRules: [
          { expiration: Duration.hours(6) } // delete anything older than 6hrs!
        ]
      }
    }
  })

  const baseServiceProps: MutableQueueProcessingFargateServiceProps & {
    ephemeralStorageGiB: number
  } = {
    // Building image from local Dockerfile https://docs.aws.amazon.com/cdk/v2/guide/assets.html
    // Requires Docker running locally
    // Note: this is run from /.build/<somehting> so the path to the Dockerfile is not quite what you'd expect.
    image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
      platform: Platform.LINUX_AMD64
    }),
    containerName: 'pickup',
    propagateTags: PropagatedTagSource.TASK_DEFINITION,
    minScalingCapacity: 1,
    maxScalingCapacity: 10,
    ephemeralStorageGiB: 200, // max 200
    environment: {
      SQS_QUEUE_URL: basicApi.queue.queueUrl,
      DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName,
      VALIDATION_BUCKET: (validationBucket != null) ? validationBucket.bucketName : '',
      ...optionalEnv([
        'IPFS_API_URL',
        'BATCH_SIZE',
        'MAX_CAR_BYTES',
        'FETCH_TIMEOUT_MS',
        'FETCH_CHUNK_TIMEOUT_MS'
      ])
    },
    queue: basicApi.queue.cdk.queue,
    enableExecuteCommand: true,
    healthCheck: {
      command: ['CMD-SHELL', 'ps -ef | grep pickup || exit 1'],
      // the properties below are optional
      interval: Duration.seconds(5),
      retries: 2,
      startPeriod: Duration.seconds(5),
      timeout: Duration.seconds(20)
    },
    cluster,
    scalingSteps: [
      { upper: 0, change: -1 },
      { lower: 20, change: +1 },
      { lower: 100, change: +5 }
    ]
  }

  // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#queue-processing-services
  // export logs to loki just on prod and stg environments
  if (app.stage === 'prod' || app.stage === 'staging') {
    const service = new QueueProcessingFargateService(stack, 'Service', {
      ...baseServiceProps,
      cpu: 8192,
      memoryLimitMiB: 60 * 1024,
      logDriver: getLogger(app, stack)
    })

    // add role to read parameter
    service.taskDefinition.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'))
    // configure the custom image to log router
    service.taskDefinition.addFirelensLogRouter('log-router', {
      firelensConfig: {
        type: FirelensLogRouterType.FLUENTBIT
      },
      image: ContainerImage.fromRegistry('grafana/fluent-bit-plugin-loki:1.6.0-amd64')
    })
    // go-ipfs as sidecar!
    // see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#deploy-application-and-metrics-sidecar
    service.taskDefinition.addContainer('ipfs', {
      // route logs to grafana loki
      logging: lokiLogs,
      image: ContainerImage.fromAsset(new URL('../../pickup/ipfs/', import.meta.url).pathname, {
        platform: Platform.LINUX_AMD64
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'ipfs cat /ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc/readme || exit 1'],
        // the properties below are optional
        interval: Duration.seconds(5),
        retries: 2,
        startPeriod: Duration.seconds(5),
        timeout: Duration.seconds(20)
      }
    })
    basicApi.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
    basicApi.dynamoDbTable.cdk.table.grantReadWriteData(service.taskDefinition.taskRole)
    basicApi.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)
    validationBucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
  } else {
    const service = new QueueProcessingFargateService(stack, 'Service', {
      ...baseServiceProps,
      cpu: 4096,
      memoryLimitMiB: 8192
    })
    // go-ipfs as sidecar!
    // see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#deploy-application-and-metrics-sidecar
    service.taskDefinition.addContainer('ipfs', {
      logging: service.logDriver,
      image: ContainerImage.fromAsset(new URL('../../pickup/ipfs/', import.meta.url).pathname, {
        platform: Platform.LINUX_AMD64
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'ipfs cat /ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc/readme || exit 1'],
        // the properties below are optional
        interval: Duration.seconds(5),
        retries: 2,
        startPeriod: Duration.seconds(5),
        timeout: Duration.seconds(20)
      }
    })
    basicApi.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
    basicApi.dynamoDbTable.cdk.table.grantReadWriteData(service.taskDefinition.taskRole)
    basicApi.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)
    validationBucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
  }
}

function createVPCGateways (vpc: ec2.IVpc): void {
  if (vpc != null) {
    const subnets = [
      { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
    ]
    vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets
    })
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets
    })
  } else {
    const errMessage = 'Can\'t add gateway to undefined VPC'
    console.error(errMessage)
    throw new Error('Can\'t add gateway to undefined VPC')
  }
}

/**
 * Create an env object to pass specified keys to an sst construct
 * from keys that may be on the current process.env
 */
export function optionalEnv (keys: string[]): Record<string, string> {
  const res: Record<string, string> = {}
  for (const key of keys) {
    const val = process.env[key]
    if (val === undefined) continue
    res[key] = val
  }
  return res
}

export function getLogger (app, stack) {
  // read secret url from parameter store
  const grafanaSecret = aws_ssm.StringParameter.fromStringParameterName(
    stack,
    'gf-id',
    'grafanahost'
  )
  const lokiLogs = LogDrivers.firelens({
    options: {
      Name: 'loki',
      env: app.stage,
      labels: `{job="${app.stage}-pickup"}`,
      remove_keys: 'ecs_task_arn',
      label_keys: 'container_name,container_id,ecs_task_definition,source,ecs_cluster',
      line_format: 'key_value'
    },
    secretOptions: { // Retrieved from AWS Systems Manager Parameter Store
      url: Secret.fromSsmParameter(grafanaSecret)
    }
  })
  return lokiLogs
}
