import { Config } from '@serverless-stack/node/config/index.js'
import { Response } from '../schema.js'

const emptyOrNil = (input: string): boolean => (input?.trim()?.length || 0) === 0

export function doAuth (
  authorizationHeader: string | undefined
): Response | undefined {
  if (
    authorizationHeader !== `Basic ${getValidCredentials()}` ||
    emptyOrNil(authorizationHeader)
  ) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { reason: 'UNAUTHORIZED' } })
    }
  }
}

function getValidCredentials (): string {
  let validCredentials = process.env.CLUSTER_BASIC_AUTH_TOKEN
  if (!validCredentials) {
    // If not set as environment variable...
    // eslint-disable-next-line padded-blocks 
    // ts-ignore
    validCredentials = Config.AUTH_TOKEN // ... Get it from AWS SSM parameter store
  }
  return validCredentials
}
