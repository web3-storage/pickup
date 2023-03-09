import { createPickupFromEnv } from './lib/pickup'
import { logger } from './lib/logger.js'

async function start () {
  logger.info({}, 'Pickup starting...')
  try {
    const pickup = await createPickupFromEnv()
    await pickup.start()
  } catch (err) {
    logger.error(err, 'Pickup ded!')
    throw err
  }
}

start()
