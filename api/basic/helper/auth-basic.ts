import { Config } from '@serverless-stack/node/config'
import { Response } from '../schema.js'

export function doAuth(authorizationHeader: string): Response | undefined {
  if (authorizationHeader !== `Basic ${getValidCredentials()}`) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { reason: 'UNAUTHORIZED' } }),
    }
  }
}

async function getValidCredentials() {
  let validCredentials = process.env.CLUSTER_BASIC_AUTH_TOKEN
  if (!validCredentials) {
    // If not set as environment variable...
    // @ts-ignore:next-line
    validCredentials = Config.AUTH_TOKEN //... Get it from AWS SSM parameter store
  }
  return validCredentials
}
