import { Config } from '@serverless-stack/node/config'

export function doAuth(authorizationHeader) {
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
    validCredentials = Config.AUTH_TOKEN //... Get it from AWS SSM parameter store
  }
  return validCredentials
}
