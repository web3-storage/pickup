import { Tags } from 'aws-cdk-lib'
import { PickupStack } from './PickupStack'
import { BasicApiStack } from './BasicApiStack'
import { App } from '@serverless-stack/resources'
import { SSMSecureParameterService } from './lib/ssm-secure-parameter-service'

export default async function (app: App) {
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

  const ssmSecureParameterService = new SSMSecureParameterService(app.region);
  await ssmSecureParameterService.putIfNotExists('/test/pickup/secure/created', tagList)

  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    srcPath: 'api',
    bundle: {
      format: 'esm',
    },
  })
  app.stack(BasicApiStack)
  app.stack(PickupStack)

  // tags let us discover all the aws resource costs incurred by this app
  // see: https://docs.sst.dev/advanced/tagging-resources
  for (const tag of tagList) {
    Tags.of(app).add(tag.Key, tag.Value)
  }
}
