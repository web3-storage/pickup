import { StackContext, use, Queue, Bucket, Table } from '@serverless-stack/resources'
import { BasicApiStack } from './BasicApiStack'
import { Cluster, ContainerImage, LogDrivers, Secret, FirelensLogRouterType, LogDriver } from 'aws-cdk-lib/aws-ecs'
import { Platform } from 'aws-cdk-lib/aws-ecr-assets'
import { QueueProcessingFargateService, QueueProcessingFargateServiceProps } from './lib/queue-processing-fargate-service'
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam'
import { Duration, aws_ssm } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'

type MutableQueueProcessingFargateServiceProps = { // The same object without readonly
  -readonly [key in keyof QueueProcessingFargateServiceProps]: QueueProcessingFargateServiceProps[key];
}

export function PickupStack ({ app, stack }: StackContext): void {
  const basicApi = use(BasicApiStack) as unknown as { queue: Queue, bucket: Bucket, dynamoDbTable: Table, updatePinQueue: Queue }
  const cluster = new Cluster(stack, 'ipfs', {
    containerInsights: true
  })
  // Network calls to S3 and dynamodb through internal network
  createVPCGateways(cluster.vpc)

  const baseServiceProps: MutableQueueProcessingFargateServiceProps & {
    ephemeralStorageGiB: number
  } = {
    // Builing image from local Dockerfile https://docs.aws.amazon.com/cdk/v2/guide/assets.html
    // Requires Docker running locally
    // Note: this is run from /.build/<somehting> so the path to the Dockerfile is not quite what you'd expect.
    image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
      platform: Platform.LINUX_AMD64
    }),
    containerName: 'pickup',
    minScalingCapacity: process.env.MIN_SCALING_CAPACITY !== undefined ? parseInt(process.env.MIN_SCALING_CAPACITY) : 1,
    maxScalingCapacity: 10,
    ephemeralStorageGiB: 64, // max 200
    environment: {
      SQS_QUEUE_URL: basicApi.queue.queueUrl,
      IPFS_API_URL: 'http://127.0.0.1:5001',
      DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName,
      BATCH_SIZE: process.env.BATCH_SIZE ?? '5',
      TIMEOUT_FETCH: process.env.TIMEOUT_FETCH ?? '60',
      MAX_RETRY: process.env.MAX_RETRY ?? '10'
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

    const service = new QueueProcessingFargateService(stack, 'Service', {
      ...baseServiceProps,
      cpu: 8192,
      memoryLimitMiB: 60 * 1024,
      logDriver: lokiLogs
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
  }

  if (process.env.USE_VALIDATION === 'VALIDATE') {
    const productionParams: {
      logDriver?: LogDriver
      cpu?: number
      memoryLimitMiB?: number
      ephemeralStorageGiB?: number
    } = {}

    if (app.stage === 'prod' || app.stage === 'staging') {
      const grafanaSecret = aws_ssm.StringParameter.fromStringParameterName(
        stack,
        'gf-id-validator',
        'grafanahost'
      )

      productionParams.logDriver = LogDrivers.firelens({
        options: {
          Name: 'loki',
          env: app.stage,
          labels: `{job="${app.stage}-pickup-validator"}`,
          remove_keys: 'ecs_task_arn',
          label_keys: 'container_name,container_id,ecs_task_definition,source,ecs_cluster',
          line_format: 'key_value'
        },
        secretOptions: { // Retrieved from AWS Systems Manager Parameter Store
          url: Secret.fromSsmParameter(grafanaSecret)
        }
      })

      productionParams.cpu = 16384
      productionParams.memoryLimitMiB = 80 * 1024
      productionParams.ephemeralStorageGiB = 80
    }

    const validationService = new QueueProcessingFargateService(stack, 'ServiceValidator', {
      image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
        platform: Platform.LINUX_AMD64,
        file: 'Dockerfile.Validator'
      }),
      containerName: 'validator',
      maxScalingCapacity: 1,
      cpu: 4096,
      memoryLimitMiB: 16 * 1024,
      ephemeralStorageGiB: 30, // max 200
      environment: {
        SQS_QUEUE_URL: basicApi.updatePinQueue.queueUrl,
        DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName
      },
      queue: basicApi.updatePinQueue.cdk.queue,
      enableExecuteCommand: true,
      cluster,
      ...productionParams
    })
    basicApi.bucket.cdk.bucket.grantReadWrite(validationService.taskDefinition.taskRole)
    basicApi.dynamoDbTable.cdk.table.grantReadWriteData(validationService.taskDefinition.taskRole)
    basicApi.updatePinQueue.cdk.queue.grantConsumeMessages(validationService.taskDefinition.taskRole)

    validationService.taskDefinition.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'))
    // configure the custom image to log router
    validationService.taskDefinition.addFirelensLogRouter('log-router', {
      firelensConfig: {
        type: FirelensLogRouterType.FLUENTBIT
      },
      image: ContainerImage.fromRegistry('grafana/fluent-bit-plugin-loki:1.6.0-amd64')
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
