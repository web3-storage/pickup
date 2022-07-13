import { StackContext, use, Queue, Bucket } from '@serverless-stack/resources'
import { ApiStack } from './ApiStack'
import { ContainerImage } from 'aws-cdk-lib/aws-ecs'
import { QueueProcessingFargateService } from './lib/queue-processing-fargate-service'

export function PickupStack ({ stack }: StackContext): void {
  const pinService = use(ApiStack) as unknown as { queue: Queue, bucket: Bucket }

  // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#queue-processing-services
  const service = new QueueProcessingFargateService(stack, 'Service', {
    // Builing image from local Dockerfile https://docs.aws.amazon.com/cdk/v2/guide/assets.html
    // Requires Docker running locally
    // Note: this is run from /.build/<somehting> so the path to the Dockerfile is not quite what you'd expect.
    image: ContainerImage.fromAsset(new URL('../../', import.meta.url).pathname),
    containerName: 'pickup',
    maxScalingCapacity: 2,
    cpu: 512,
    memoryLimitMiB: 1024,
    ephemeralStorageGiB: 64, // max 200
    // cpu: 4096,
    // memoryLimitMiB: 8192,
    environment: {
      SQS_QUEUE_URL: pinService.queue.queueUrl,
      IPFS_API_URL: 'http://127.0.0.1:5001'
    },
    queue: pinService.queue.cdk.queue
    // retentionPeriod: Duration.days(1),
    // visibilityTimeout: Duration.minutes(5),
  })

  // go-ipfs as sidecar!
  // see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html#deploy-application-and-metrics-sidecar
  service.taskDefinition.addContainer('ipfs', {
    image: ContainerImage.fromRegistry('ipfs/go-ipfs:v0.13.1')
    // environment: {
    //   IPFS_PATH: '/data/ipfs'
    // }
  })

  pinService.bucket.cdk.bucket.grantReadWrite(service.taskDefinition.taskRole)
  pinService.queue.cdk.queue.grantConsumeMessages(service.taskDefinition.taskRole)
}
