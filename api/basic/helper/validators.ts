import { Response } from '../schema.js'
import { isCID, isMultiaddr } from './cid.js'

export function validateDynamoDBConfiguration ({ table }: { table: string }): Response | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!table) {
    return {
      statusCode: 500,
      body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'TABLE must be set in ENV' } }
    }
  }
}

export function validateS3Configuration ({ bucket }: { bucket: string }): Response | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!bucket) {
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'BUCKET_NAME must be set in ENV' } } }
  }
}

export function validateSQSConfiguration ({ queueUrl }: { queueUrl: string }): Response | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!queueUrl) {
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'QUEUE_URL must be set in ENV' } } }
  }
}

export function validateRoutingConfiguration ({
  legacyClusterIpfsUrl,
  pickupUrl
}: { legacyClusterIpfsUrl: string, pickupUrl: string }): Response | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!legacyClusterIpfsUrl) {
    return {
      statusCode: 500,
      body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'LEGACY_CLUSTER_IPFS_URL not defined' } }
    }
  }

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!pickupUrl) {
    return {
      statusCode: 500,
      body: { error: { reason: 'INTERNAL_SERVER_ERROR', details: 'PICKUP_URL not defined' } }
    }
  }
}

export function validateEventParameters ({
  cid,
  origins = []
}: { cid: string, origins?: string[] }): Response | undefined {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!cid) {
    return { statusCode: 400, body: { error: { reason: 'BAD_REQUEST', details: 'CID not found in path' } } }
  }

  if (!isCID(cid)) {
    return {
      statusCode: 400,
      body: { error: { reason: 'BAD_REQUEST', details: `${cid} is not a valid CID` } }
    }
  }

  for (const str of origins) {
    if (!isMultiaddr(str)) {
      return {
        statusCode: 400,
        body: { error: { reason: 'BAD_REQUEST', details: `${str} in origins is not a valid multiaddr` } }
      }
    }
  }
}