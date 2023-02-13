import { DeleteObjectCommand, CopyObjectCommand, S3Client } from '@aws-sdk/client-s3'

/**
 * Create the S3Client
 *
 * @returns {import('@aws-sdk/client-s3'.S3Client)}
 */
export function createS3Client () {
  return new S3Client({})
}

/**
 * Copy a file from a bucket to another
 *
 * @returns {import('@aws-sdk/client-s3'.S3Client)}
 */
export async function copyFile ({ client = createS3Client(), sourceBucket, destinationBucket, key }) {
  const command = new CopyObjectCommand({
    CopySource: `${sourceBucket}/${key}`,
    Bucket: destinationBucket,
    Key: key
  })
  return await client.send(command)
}

/**
 * Remove a file from a bucket
 *
 * @returns {import('@aws-sdk/client-s3'.S3Client)}
 */
export async function removeFile ({ client = createS3Client(), bucket, key }) {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key
  })
  return await client.send(command)
}
