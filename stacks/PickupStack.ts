import type { App, Stack } from '@serverless-stack/resources'
import { StackContext, use, Queue, Bucket, Table } from '@serverless-stack/resources'
import { BasicApiStack } from './BasicApiStack'
import { Cluster, ContainerImage, LogDrivers, Secret, FirelensLogRouterType, LogDriver, PropagatedTagSource } from 'aws-cdk-lib/aws-ecs'
import { Platform } from 'aws-cdk-lib/aws-ecr-assets'
import { QueueProcessingFargateService } from './lib/queue-processing-fargate-service'
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam'
import { Duration, aws_ssm } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'

export function PickupStack ({ app, stack }: StackContext): void {
  const basicApi = use(BasicApiStack) as unknown as { queue: Queue, bucket: Bucket, dynamoDbTable: Table }

  const validationBucket = new Bucket(stack, 'ValidationCar', {
    cdk: {
      bucket: {
        lifecycleRules: [
          { expiration: Duration.days(1) } // minimum is 1 day
        ]
      }
    }
  })

  const cluster = new Cluster(stack, 'ipfs', {
    containerInsights: true
  })
  // Network calls to S3 and dynamodb through internal network
  createVPCGateways(cluster.vpc)

  const service = new QueueProcessingFargateService(stack, 'Service', {
    cluster,
    // Build image from local Dockerfile. Requires Docker running locally. https://docs.aws.amazon.com/cdk/v2/guide/assets.html
    // This is run from /.build/<something> so the path to the Dockerfile traveses up one more level than in the source tree.
    image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
      platform: Platform.LINUX_AMD64
    }),
    containerName: 'pickup',
    propagateTags: PropagatedTagSource.TASK_DEFINITION,
    minScalingCapacity: 1,
    maxScalingCapacity: 10,
    ephemeralStorageGiB: isPrBuild(app) ? 21 : 200, // requried to be > 20!
    logDriver: isPrBuild(app) ? undefined : getLokiLogDriver(app, stack), // use aws cloudwatch in PRs, loki in prod.
    cpu: 4096, /* 4 vCPU. Task eats CPU. */
    memoryLimitMiB: 8 * 1024, /* 8 GB RAM, min allowed with 4 vCPU */
    assignPublicIp: true,
    environment: {
      SQS_QUEUE_URL: basicApi.queue.queueUrl,
      DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName,
      DESTINATION_BUCKET: basicApi.bucket.bucketName,
      VALIDATION_BUCKET: validationBucket.bucketName,
      ...optionalEnv([
        'IPFS_API_URL',
        'BATCH_SIZE',
        'MAX_CAR_BYTES',
        'FETCH_TIMEOUT_MS',
        'FETCH_CHUNK_TIMEOUT_MS'
      ])
    },
    queue: basicApi.queue.cdk.queue,
    enableExecuteCommand: isPrBuild(app),
    healthCheck: {
      command: ['CMD-SHELL', 'ps -ef | grep pickup || exit 1'],
      // the properties below are optional
      interval: Duration.seconds(5),
      retries: 2,
      startPeriod: Duration.seconds(5),
      timeout: Duration.seconds(20)
    },
    scalingSteps: [
      { upper: 0, change: -1 },
      { lower: 20, change: +1 },
      { lower: 100, change: +5 }
    ]
  })

  // add go-ipfs as sidecar! see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#deploy-application-and-metrics-sidecar
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

  // set up permissions so cluster tasks can use buckets and db
  basicApi.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
  basicApi.dynamoDbTable.cdk.table.grantReadWriteData(service.taskDefinition.taskRole)
  basicApi.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)
  validationBucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)

  if (!isPrBuild(app)) {
    // configure loki just on prod and stg environments
    // add role to read parameter
    service.taskDefinition.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'))
    // configure the custom image to log router
    service.taskDefinition.addFirelensLogRouter('log-router', {
      firelensConfig: {
        type: FirelensLogRouterType.FLUENTBIT
      },
      image: ContainerImage.fromRegistry('grafana/fluent-bit-plugin-loki:2.7.4-amd64')
    })
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

export function isPrBuild ({ stage }: App): boolean {
  return stage !== 'prod' && stage !== 'staging'
}

export function getLokiLogDriver (app: App, stack: Stack): LogDriver {
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
