import { PickupStack } from './PickupStack'
import { PinningServiceStack } from './PinningServiceStack'
import { App } from '@serverless-stack/resources'

export default function (app: App): void {
  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    srcPath: 'backend',
    bundle: {
      format: 'esm'
    }
  })
  app.stack(PinningServiceStack)
  app.stack(PickupStack)
}
