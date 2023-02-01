import { StackContext, use, Queue, Bucket, Table } from '@serverless-stack/resources'
import { BasicApiStack } from './BasicApiStack'
import { Cluster, ContainerImage, LogDrivers, Secret, FirelensLogRouterType } from 'aws-cdk-lib/aws-ecs'
import { Platform } from 'aws-cdk-lib/aws-ecr-assets'
import { QueueProcessingFargateService } from './lib/queue-processing-fargate-service'
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam'
import { aws_ssm } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'

export function PickupStack ({ app, stack }: StackContext): void {
  const basicApi = use(BasicApiStack) as unknown as { queue: Queue, bucket: Bucket, dynamoDbTable: Table, updatePinQueue: Queue }
  const cluster = new Cluster(stack, 'ipfs', {
    containerInsights: true
  })
  // Network calls to S3 and dynamodb through internal network
  createVPCGateways(cluster.vpc)
  // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#queue-processing-services
  // export logs to loki just on prod and stg environments
  if (app.stage === 'prod' || app.stage === 'staging') {
    // read secret url from parameter store
    const grafanasecret = aws_ssm.StringParameter.fromStringParameterName(
      stack,
      'gf-id',
      'grafanahost'
    )
    const lokilogs = LogDrivers.firelens({
      options: {
        Name: 'loki',
        env: app.stage,
        labels: `{job="${app.stage}-pickup"}`,
        remove_keys: 'ecs_task_arn',
        label_keys: 'container_name,container_id,ecs_task_definition,source,ecs_cluster',
        line_format: 'key_value'
      },
      secretOptions: { // Retrieved from AWS Systems Manager Parameter Store
        url: Secret.fromSsmParameter(grafanasecret)
      }
    })
    const service = new QueueProcessingFargateService(stack, 'Service', {
      // Builing image from local Dockerfile https://docs.aws.amazon.com/cdk/v2/guide/assets.html
      // Requires Docker running locally
      // Note: this is run from /.build/<somehting> so the path to the Dockerfile is not quite what you'd expect.
      image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
        platform: Platform.LINUX_AMD64
      }),
      containerName: 'pickup',
      // route logs to grafana loki
      logDriver: lokilogs,
      maxScalingCapacity: 10,
      cpu: 4096,
      memoryLimitMiB: 8192,
      ephemeralStorageGiB: 64, // max 200
      environment: {
        SQS_QUEUE_URL: basicApi.queue.queueUrl,
        IPFS_API_URL: 'http://127.0.0.1:5001',
        DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName,
        BATCH_SIZE: process.env.BATCH_SIZE ?? '5',
        MAX_RETRY: process.env.MAX_RETRY ?? '10'
      },
      queue: basicApi.queue.cdk.queue,
      // retentionPeriod: Duration.days(1),
      // visibilityTimeout: Duration.minutes(5),
      // for debug!
      enableExecuteCommand: true,
      cluster
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
      logging: lokilogs,
      image: ContainerImage.fromAsset(new URL('../../pickup/ipfs/', import.meta.url).pathname, {
        platform: Platform.LINUX_AMD64
      })
    })
    basicApi.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
    basicApi.dynamoDbTable.cdk.table.grantReadWriteData(service.taskDefinition.taskRole)
    basicApi.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)

    if (process.env.USE_VALIDATION === 'VALIDATE') {
      const validationService = new QueueProcessingFargateService(stack, 'ServiceValidator', {
        image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
          platform: Platform.LINUX_AMD64,
          file: 'Dockerfile.Validator'
        }),
        containerName: 'validator',
        maxScalingCapacity: 1,
        cpu: 4096,
        memoryLimitMiB: 8 * 1024,
        ephemeralStorageGiB: 24, // max 200
        environment: {
          SQS_QUEUE_URL: basicApi.updatePinQueue.queueUrl,
          DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName
        },
        queue: basicApi.updatePinQueue.cdk.queue,
        enableExecuteCommand: true,
        cluster
      })
      basicApi.bucket.cdk.bucket.grantReadWrite(validationService.taskDefinition.taskRole)
      basicApi.dynamoDbTable.cdk.table.grantReadWriteData(validationService.taskDefinition.taskRole)
      basicApi.updatePinQueue.cdk.queue.grantConsumeMessages(validationService.taskDefinition.taskRole)
    }
  } else {
    const service = new QueueProcessingFargateService(stack, 'Service', {
      image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
        platform: Platform.LINUX_AMD64
      }),
      containerName: 'pickup',
      maxScalingCapacity: 10,
      cpu: 4096,
      memoryLimitMiB: 8192,
      ephemeralStorageGiB: 64, // max 200
      environment: {
        SQS_QUEUE_URL: basicApi.queue.queueUrl,
        IPFS_API_URL: 'http://127.0.0.1:5001',
        DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName,
        BATCH_SIZE: process.env.BATCH_SIZE ?? '5',
        TIMEOUT_FETCH: process.env.TIMEOUT_FETCH ?? '60'
      },
      queue: basicApi.queue.cdk.queue,
      enableExecuteCommand: true,
      cluster
    })
    // go-ipfs as sidecar!
    // see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#deploy-application-and-metrics-sidecar
    service.taskDefinition.addContainer('ipfs', {
      logging: service.logDriver,
      image: ContainerImage.fromAsset(new URL('../../pickup/ipfs/', import.meta.url).pathname, {
        platform: Platform.LINUX_AMD64
      })
    })
    basicApi.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
    basicApi.dynamoDbTable.cdk.table.grantReadWriteData(service.taskDefinition.taskRole)
    basicApi.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)

    if (process.env.USE_VALIDATION === 'VALIDATE') {
      const validationService = new QueueProcessingFargateService(stack, 'ServiceValidator', {
        image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
          platform: Platform.LINUX_AMD64,
          file: 'Dockerfile.Validator'
        }),
        containerName: 'validator',
        maxScalingCapacity: 1,
        cpu: 4096,
        memoryLimitMiB: 8 * 1024,
        ephemeralStorageGiB: 24, // max 200
        environment: {
          SQS_QUEUE_URL: basicApi.updatePinQueue.queueUrl,
          DYNAMO_TABLE_NAME: basicApi.dynamoDbTable.tableName
        },
        queue: basicApi.updatePinQueue.cdk.queue,
        enableExecuteCommand: true,
        cluster
      })
      basicApi.bucket.cdk.bucket.grantReadWrite(validationService.taskDefinition.taskRole)
      basicApi.dynamoDbTable.cdk.table.grantReadWriteData(validationService.taskDefinition.taskRole)
      basicApi.updatePinQueue.cdk.queue.grantConsumeMessages(validationService.taskDefinition.taskRole)
    }
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
