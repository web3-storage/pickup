import { Tags } from 'aws-cdk-lib'
import { PickupStack } from './PickupStack'
import { BasicApiStack } from './BasicApiStack'
import { SecretStack } from './SecretStack'
import { App } from '@serverless-stack/resources'

export default function (app: App) {
  const tagList = [
    {
      Key: 'Project',
      Value: 'pickup',
    },
    {
      Key: 'Repository',
      Value: 'https://github.com/web3-storage/pickup',
    },
    {
      Key: 'Environment',
      Value: app.stage,
    },
    {
      Key: 'ManagedBy',
      Value: 'SST',
    },
  ]

  

  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    srcPath: 'api',
    bundle: {
      format: 'esm',
    },
  })
  app.stack(BasicApiStack)
  app.stack(PickupStack)
  app.stack(SecretStack, tagList)

  // tags let us discover all the aws resource costs incurred by this app
  // see: https://docs.sst.dev/advanced/tagging-resources
  for (const tag of tagList) {
    Tags.of(app).add(tag.Key, tag.Value)
  }
}
