import { PickupStack } from './PickupStack'
import { BasicApiStack } from './BasicApiStack'
import { App } from '@serverless-stack/resources'

export default function (app: App): void {
  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    srcPath: 'api',
    bundle: {
      format: 'esm'
    }
  })
  app.stack(BasicApiStack)
  app.stack(PickupStack)
}
