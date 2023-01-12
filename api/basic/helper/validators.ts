import { ValidationError } from '../schema.js'
import { isCID, isMultiaddr } from './cid.js'

export function validateDynamoDBConfiguration({ table }: { table: string }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!table) {
    return {
      code: 'INVALID_DYNAMO_CONFIG',
      message: 'TABLE must be set in ENV'
    }
  }
}

export function validateS3Configuration({ bucket }: { bucket: string }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!bucket) {
    return {
      code: 'INVALID_S3_CONFIG',
      message: 'BUCKET_NAME must be set in ENV'
    }
  }
}


export function validateSQSConfiguration({ queueUrl }: { queueUrl: string }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!queueUrl) {
    return {
      code: 'INVALID_SQS_CONFIG',
      message: 'QUEUE_URL must be set in ENV'
    }
  }
}

export function validateRoutingConfiguration({
  legacyClusterIpfsUrl,
  pickupUrl
}: { legacyClusterIpfsUrl: string, pickupUrl: string }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!legacyClusterIpfsUrl) {
    return {
      code: 'INVALID_ROUTING_CONFIG',
      message: 'LEGACY_CLUSTER_IPFS_URL not defined'
    }
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!pickupUrl) {
    return {
      code: 'INVALID_ROUTING_CONFIG',
      message: 'PICKUP_URL not defined'
    }
  }
}

export function validateEventParameters({
  cid,
  origins = []
}: { cid: string, origins?: string[] }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!cid) {
    return {
      code: 'INVALID_EVENT_PARAMS_MISSING_CID',
      message: 'CID not found in path'
    }
  }

  if (!isCID(cid)) {
    return {
      code: 'INVALID_EVENT_PARAMS_INVALID_CID',
      message: 'Invalid CID'
    }
  }

  for (const str of origins) {
    if (!isMultiaddr(str)) {
      return {
        code: 'INVALID_EVENT_PARAMS_INVALID_ORIGIN',
        message: `${str} in origins is not a valid multiaddr`
      }
    }
  }
}

export function validateGetPinsParameters ({
  cids
}: { cids: string }): Response | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!cids) {
    return { statusCode: 400, body: { error: { reason: 'BAD_REQUEST', details: '"cids" parameter not found' } } }
  }

  // eslint-ignore-next-line
  if (typeof (cids) !== 'string') {
    return { statusCode: 400, body: { error: { reason: 'BAD_REQUEST', details: '"cids" parameter should be a comma separated string' } } }
  }

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const errors = cids.split(',').map(cid => !isCID(cid) ? `${cid} is not a valid CID` : null).filter(error => !!error)
  if (errors.length > 0) {
    return {
      statusCode: 400,
      body: { error: { reason: 'BAD_REQUEST', details: errors.join(', ') } }
    }
  }
}
