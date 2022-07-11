import { StackContext, use, Queue, Bucket } from '@serverless-stack/resources'
import { PinningServiceStack } from './PinningServiceStack'
import { SymlinkFollowMode } from 'aws-cdk-lib'
import { ContainerImage } from 'aws-cdk-lib/aws-ecs'
// import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns' // forked as missing ephemeralStorage param.
import { QueueProcessingFargateService } from './lib/queue-processing-fargate-service'

export function PickupStack ({ stack }: StackContext): void {
  const pinService = use(PinningServiceStack) as unknown as { queue: Queue, bucket: Bucket }

  // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#queue-processing-services
  const service = new QueueProcessingFargateService(stack, 'Service', {
    // Builing image from local Dockerfile https://docs.aws.amazon.com/cdk/v2/guide/assets.html
    image: ContainerImage.fromAsset(new URL('../../pickup', import.meta.url).pathname, {
      // todo: remove me
      followSymlinks: SymlinkFollowMode.ALWAYS
    }),
    containerName: 'pickup',
    maxScalingCapacity: 2,
    cpu: 512,
    memoryLimitMiB: 1024,
    ephemeralStorageGiB: 64, // max 200
    // cpu: 4096,
    // memoryLimitMiB: 8192,
    environment: {
      SQS_QUEUE_URL: pinService.queue.queueUrl,
      GATEWAY_URL: 'http://127.0.0.1:8080'
    },
    queue: pinService.queue.cdk.queue
    // retentionPeriod: Duration.days(1),
    // visibilityTimeout: Duration.minutes(5),
  })

  // go-ipfs as sidecar!
  // see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#deploy-application-and-metrics-sidecar
  service.taskDefinition.addContainer('ipfs', {
    image: ContainerImage.fromRegistry('ipfs/go-ipfs:v0.13.0')
    // environment: {
    //   IPFS_PATH: '/data/ipfs'
    // }
  })

  pinService.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
  pinService.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)
}
