import { Tags, RemovalPolicy } from 'aws-cdk-lib'
import { PickupStack, isPrBuild } from './PickupStack'
import { BasicApiStack } from './BasicApiStack'
import { App } from '@serverless-stack/resources'

export default function (app: App): void {
  if (isPrBuild(app)) {
    app.setDefaultRemovalPolicy(RemovalPolicy.DESTROY)
  }

  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    srcPath: 'api',
    bundle: {
      format: 'esm'
    }
  })
  app.stack(BasicApiStack)
  app.stack(PickupStack)

  // tags let us discover all the aws resource costs incurred by this app
  // see: https://docs.sst.dev/advanced/tagging-resources
  Tags.of(app).add('Project', 'pickup')
  Tags.of(app).add('Repository', 'https://github.com/web3-storage/pickup')
  Tags.of(app).add('Environment', `${app.stage}`)
  Tags.of(app).add('ManagedBy', 'SST')
}
