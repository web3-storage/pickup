import { createPickupFromEnv } from './lib/pickup.js'
import { logger } from './lib/logger.js'

async function start () {
  try {
    const pickup = createPickupFromEnv()
    logger.info('Pickup starting...')
    await pickup.start()
    logger.info('Pickup started')
  } catch (err) {
    logger.error(err, 'Pickup ded!')
    throw err
  }
}

start()
