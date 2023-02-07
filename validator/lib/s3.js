import { S3Client } from '@aws-sdk/client-s3'

/**
 * Create the S3Client
 *
 * @returns {import('@aws-sdk/client-s3'.S3Client)}
 */
export function createS3Client () {
  return new S3Client({})
}
