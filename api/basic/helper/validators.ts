import { ValidationError } from '../schema.js'
import { isCID } from './cid.js'

export function validateDynamoDBConfiguration ({ table }: { table: string }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!table) {
    return {
      code: 'INVALID_DYNAMO_CONFIG',
      message: 'TABLE must be set in ENV'
    }
  }
}

export function validateS3Configuration ({ bucket }: { bucket: string }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!bucket) {
    return {
      code: 'INVALID_S3_CONFIG',
      message: 'BUCKET_NAME must be set in ENV'
    }
  }
}

export function validateSQSConfiguration ({ queueUrl }: { queueUrl: string }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!queueUrl) {
    return {
      code: 'INVALID_SQS_CONFIG',
      message: 'QUEUE_URL must be set in ENV'
    }
  }
}

export function validateRoutingConfiguration ({
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

export function validateEventParameters ({
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
}

export function validateGetPinsParameters ({
  cids
}: { cids: string | undefined }): ValidationError | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!cids) {
    return {
      code: 'INVALID_EVENT_PARAMS_INVALID_CIDS',
      message: '"cids" parameter not found'
    }
  }

  // eslint-ignore-next-line
  if (typeof (cids) !== 'string') {
    return {
      code: 'INVALID_EVENT_PARAMS_INVALID_CIDS',
      message: '"cids" parameter should be a comma separated string'
    }
  }

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const errors = cids.split(',').map(cid => !isCID(cid) ? `${cid} is not a valid CID` : null).filter(error => !!error)
  if (errors.length > 0) {
    return {
      code: 'INVALID_EVENT_PARAMS_INVALID_CIDS',
      message: errors.join(', ')
    }
  }
}
