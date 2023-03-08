import { createPickupFromEnv } from './lib/pickup'
import { logger } from './lib/logger.js'

async function start () {
  logger.info({}, 'Pickup starting...')  
  const pickup = await createPickupFromEnv()
  await pickup.start()
}

start()
