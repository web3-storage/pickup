# Pickup 🛻

Fetch content from IPFS by CID save it to S3 as a CAR.

This repo deploys resources to AWS and stiches them together to provide an Lambda-based HTTP interface and a worker pool in ECS. Pin requests are queued and handled by the `pickup` service, an auto-scaling set of `kubo` nodes. The DAG is saved as a CAR to S3, where E-IPFS can index and provide it to the public IPFS network.

## API

A minimal [ipfs-cluster](https://github.com/ipfs-cluster/ipfs-cluster) compatible http API is provided for adding pins and checking pin status in [api/basic](api/basic). The response objects match the shape ipfs-cluster would return so `pickup` can be used as a drop in replacement. Many of the properties make no sense for pickup and are faked.

🏗 A full [pinning service api] is also implemented in [api/functions/PinningService.ts](api/functions/PinningService.ts), but is not currently in use. A future release may switch this to be the main interface once we need it.

### POST pins/:cid

Make a pin request by CID, asking the service to fetch the content from IPFS.

```bash
$ curl -X POST 'https://pickup.dag.haus/pins/bafybeifpaez32hlrz5tmr7scndxtjgw3auuloyuyxblynqmjw5saapewmu' -H "Authorization: Basic $PICKUP_BASIC_AUTH_TOKEN" -s | jq
{
  "replication_factor_min": -1,
  "replication_factor_max": -1,
  "name": "",
  "mode": "recursive",
  "shard_size": 0,
  "user_allocations": null,
  "expire_at": "0001-01-01T00:00:00Z",
  "metadata": {},
  "pin_update": null,
  "origins": [],
  "cid": "bafybeifpaez32hlrz5tmr7scndxtjgw3auuloyuyxblynqmjw5saapewmu",
  "type": "pin",
  "allocations": [],
  "max_depth": -1,
  "reference": null,
  "timestamp": "2022-10-21T08:50:48.304Z"
}
```

### GET /pins/:cid

Find the status of a pin

```bash
❯ curl -X GET 'https://pickup.dag.haus/pins/bafybeifpaez32hlrz5tmr7scndxtjgw3auuloyuyxblynqmjw5saapewmu' -H "Authorization: Basic $PICKUP_BASIC_AUTH_TOKEN" -s | jq
{
  "cid": "bafybeifpaez32hlrz5tmr7scndxtjgw3auuloyuyxblynqmjw5saapewmu",
  "name": "",
  "allocations": [],
  "origins": [],
  "created": "2022-10-21T08:50:48.304Z",
  "metadata": null,
  "peer_map": {
    "12D3KooWArSKMUUeLk3z2m5LKyb9wGyFL1BtWCT7Gq7Apoo77PUR": {
      "peername": "elastic-ipfs",
      "ipfs_peer_id": "bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm",
      "ipfs_peer_addresses": [
        "/dns4/elastic.dag.house/tcp/443/wss/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm"
      ],
      "status": "pinned",
      "timestamp": "2022-10-21T08:54:28.962Z",
      "error": "",
      "attempt_count": 0,
      "priority_pin": false
    }
  }
}
```

## Environment

Set the following in the pickup worker env to tune it's behavior

### `MAX_CAR_BYTES`

Maximum bytes size of a CAR that pickup will fetch. Caps the anmount of data we will pull in a single job.

**default: 31 GiB** _(33,285,996,544 bytes)_

### `FETCH_TIMEOUT_MS`

How long to wait for fetching a CAR before failing the job. Caps the amount of time we spend on a job.

**default: 4 hrs**

_2/3rs of home internet users can upload faster than 20Mbit/s (fixed broadband), at which 32GiB would transfer in 3.5hrs._

see: https://www.speedtest.net/global-index
see: https://www.omnicalculator.com/other/download-time?c=GBP&v=fileSize:32!gigabyte,downloadSpeed:5!megabit

### `FETCH_CHUNK_TIMEOUT_MS`

How long to wait between chunks of data before failing a CAR. Limit the amount of time we spend waiting of a stalled fetch.

**default: 2 min**

### `BATCH_SIZE`

How many pin requests to handle concurrently per worker.

Used to set both the concurrency per worker *and* the max number of messages each worker fetches from the queue in a single batch. 

**default: 10**

## Getting Started

PR's are deployed automatically to `https://<pr#>.pickup.dag.haus`. The `main` branch is deployed to https://staging.pickup.dag.haus and staging builds are promoted to prod manually via the UI at https://console.seed.run/dag-house/pickup

To work on this codebase you need:
- node v16
- An AWS account with the AWS CLI configured locally
- Copy `.env.tpl` to `.env.local` and set `CLUSTER_BASIC_AUTH_TOKEN` with a base64 encoded user:pass string.
- Install the deps with `npm i`

Deploy dev services to your aws account and start dev console

```console
npm start
```

See: https://docs.sst.dev for more info on how things get deployed.

To remove dev services to your aws account:

```console
npm run remove
```

## Overview

Project structure:

```
├── Dockerfile - image for the pickup worker run in ECS
├── api        - lambda & dynamoDB implementation of the pinning service api 
├── pickup     - worker to fetch cid as CAR and write to s3
└── stacks     - sst and aws cdk code to deploy all the things 
```

The pinning service API is implemented as a lambda:

`POST /pins {cid, name, origins, meta}` route creates:
- A pinning service record in a dynamo db table. Needed to fulfil the pinning service api. 
`(requestId, status, created, userid, appName, cid, name, origins[], meta{})`
- A message to sqs queue with details needed to fetch a cid and write CAR to S3. 
`(requestId, cid, origins[], awsRegion, s3Bucket, s3Path)`

The queue consumer is an autoscaling set of go-ipfs nodes (thanks @thattommyhall ✨), with a pickup sidecar, in ECS. The sidecar long-polls the sqs queue, gets next message, connects to `origins[]`, fetches `cid` as a CAR, and writes it to S3 at `(awsRegion, s3Bucket, s3Path)`.

While we wait for fetching the CAR to complete, we bump up the "visibility timeout" on the message, so that message remains hidden from other workers, up to a configured `ipfsTimeout`.

On failure, where processing hits an error or a timeout, pickup will stop incrementing the visibility timeout on the message and it becomes visible in the queue again to be retried.

After `maxRetries` we send the message to the Dead Letter Queue to take it out of circulation, and track metrics on failures.

Success means the complete CAR has been saved on s3, for indexing by Elastic provider 🌐✨. Pickup deletes the message from the queue. The CAR has the `psaRequestId` in it's metadata.

On succesful write to s3, a lambda is triggered to update status of DynamoDB record for that `psaRequestId`.

## Diagram

<pre>

                    ┌─────────────┐
                    │   lambda    │
    ●──────1.──────▶│ POST /pins  │────────2. insert──────────┐
                    └─────────────┘                           │
                           │                                  ▼
                           │                        /───────────────────\
                           │                        │                   │
                           │                        │     DynamoDB      │
                      3. send msg                   │    PinRequests    │
                           │                        │                   │
                           │                        \───────────────────/
                           │                                  ▲
                           ▼                                  │
                      ┌─────────┐                        8. update
                      │         │                             │
                      │         │                      ┌─────────────┐
                      │         │                      │   lambda    │
                      │   SQS   │                      │   S3 PUT    │
                      │  queue  │                      └─────────────┘
                      │         │                             ▲
                      │         │                             │
                      │         │                        7. S3 Event
                      └─────────┘                             │
                           │                        ┌───────────────────┐
                           │                        │                   │
                           │                        │        S3         │
                           │                        │                   │
           ─ ─ ─ ─ ─ ─ ─ ─ ┼─ 4. process msg─┐      └───────────────────┘
          │                                  │                ▲
                           │                 │                │
          │                                  │            6. S3 PUT
          ▼                ▼                 ▼                │
   ┌─────────────┐  ┌─────────────┐   ┌─────────────┐         │
┌ ─│             │─ ┤             ├ ─ ┤             ├ ┐       │
   │   pickup    │  │   pickup    │   │   pickup    │─────────┘
│  │             │  │             │   │             │ │
   └─────────────┘  └─────────────┘   └─────────────┘
│         │                │                 ▲        │
                                             │
│         │                │            5. ipfs get   │
                                             │
│         ▼                ▼                 ▼        │
   ┌─────────────┐  ┌─────────────┐   ┌─────────────┐
│  │             │  │             │   │             │ │
   │   go-ipfs   │  │   go-ipfs   │   │   go-ipfs   │
│  │             │  │             │   │             │ │
   └─────────────┘  └─────────────┘   └─────────────┘
ECS ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘

</pre>

## Validation

The system provides a validation step that run after the upload on S3. 

CARs are written to a temporary bucket. If the CAR is valid, it's copied to the target bucket, removed from the temporary one, and the pin state is updated to `pinned` on DynamoDB

## Integration with Elastic Provider

see: https://github.com/ipfs-elastic-provider/ipfs-elastic-provider

Sends a message on the indexer SQS topic from our lambda when the CAR is written to our s3 bucket.

## aws notes

remove a bunch of buckets by bucket prefix name

```sh
# danger! will delete things!
aws s3 ls | grep olizilla-pickup | awk '{print "s3://"$3}' | xargs -n 1 -I {} aws s3 rb {} --force;
```

[pinning service api]: https://ipfs.github.io/pinning-services-api-spec/
