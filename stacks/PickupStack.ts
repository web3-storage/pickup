import { StackContext, use, Queue, Bucket } from '@serverless-stack/resources'
import { BasicApiStack } from './BasicApiStack'
import { ContainerImage, LogDriver, AwsLogDriver, LogDrivers, FireLensLogDriver, Secret, FirelensLogRouter, FirelensLogRouterProps, FirelensLogRouterType, Scope} from 'aws-cdk-lib/aws-ecs'
import { Platform } from 'aws-cdk-lib/aws-ecr-assets'
import { QueueProcessingFargateService } from './lib/queue-processing-fargate-service'
import { Group, ManagedPolicy } from 'aws-cdk-lib/aws-iam'
import { servicesVersion } from 'typescript'
import { urlSource } from 'ipfs/dist/src'
import { aws_secretsmanager, SecretValue } from 'aws-cdk-lib'

export function PickupStack ({ stack }: StackContext): void {
  const basicApi = use(BasicApiStack) as unknown as { queue: Queue, bucket: Bucket }
  // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#queue-processing-services
  const service = new QueueProcessingFargateService(stack, 'Service', {
    // Builing image from local Dockerfile https://docs.aws.amazon.com/cdk/v2/guide/assets.html
    // Requires Docker running locally
    // Note: this is run from /.build/<somehting> so the path to the Dockerfile is not quite what you'd expect.
    image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname, {
      platform: Platform.LINUX_AMD64
    }),
    containerName: 'pickup',
    maxScalingCapacity: 3,
    cpu: 4096,
    memoryLimitMiB: 8192,
    ephemeralStorageGiB: 64, // max 200
    environment: {
      SQS_QUEUE_URL: basicApi.queue.queueUrl,
      IPFS_API_URL: 'http://127.0.0.1:5001'
    },
    queue: basicApi.queue.cdk.queue,
    // retentionPeriod: Duration.days(1),
    // visibilityTimeout: Duration.minutes(5),
    // for debug!
    enableExecuteCommand: true
  })
  service.taskDefinition.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'))
  // configure the custom image to log router
  service.taskDefinition.addFirelensLogRouter('log-router',{
    firelensConfig: {
      type: FirelensLogRouterType.FLUENTBIT,
    },
    image: ContainerImage.fromRegistry('grafana/fluent-bit-plugin-loki:1.6.0-amd64'),
  })

  const grafanasecret = aws_secretsmanager.Secret.fromSecretNameV2(
    stack,
    'gf-id',
    'grafanahost',
  );

  // go-ipfs as sidecar!
  // see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#deploy-application-and-metrics-sidecar
  service.taskDefinition.addContainer('ipfs', {
  // route logs to grafana loki
    logging: LogDrivers.firelens({    
      options: {
        Name: "loki",
        labels: "{job=\"pickup_production\"}",
        remove_keys: "container_id,ecs_task_arn",
        label_keys: "container_name,ecs_task_definition,source,ecs_cluster",
        line_format: "key_value",
        url: grafanasecret.secretValue.toString()
      },
    }),
    image: ContainerImage.fromAsset(new URL('../../pickup/ipfs/', import.meta.url).pathname, {
      platform: Platform.LINUX_AMD64
    })
    // command: [
    //   'daemon',
    //   '--profile=server' // Disables local host discovery. https://github.com/ipfs/kubo/blob/master/docs/config.md#profiles
    //   // '--migrate=true',         // upgrade the repo if needed. copied from the default command. https://github.com/ipfs/kubo/blob/a6687744c703c5c020f4c004ca73f024c3bae4f7/Dockerfile#L120
    //   // '--routing=dhtclient'     // Node will query the DHT as a client but will not respond to requests from other peers. This mode is less resource-intensive than server mode. https://github.com/ipfs/kubo/blob/master/docs/config.md#routingtype
    //   // '--enable-namesys-pubsub' // web3.storage cluster default
    // ]
  })

  basicApi.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
  basicApi.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)
}




