# Pickup 🛻

Fetch content from IPFS by CID save it to S3 as a CAR.

This repo deploys resources to AWS and stiches them together to provide an Lambda-based HTTP interface and a worker pool in ECS. Pin requests are queued and handled by the `pickup` service, an auto-scaling set of `kubo` nodes. The DAG is saved as a CAR to S3, where E-IPFS can index and provide it to the public IPFS network.

## API

A minimal [ipfs-cluster](https://github.com/ipfs-cluster/ipfs-cluster) compatible http API is provided for adding pins and checking pin status in [api/basic](api/basic). The response objects match the shape ipfs-cluster would return so `pickup` can be used as a drop in replacement. Many of the properties make no sense for pickup and are faked.

🏗 A full [pinning service api] is also implemented in [api/functions/PinningService.ts](api/functions/PinningService.ts), but is not currently in use. A future release may switch this to be the main interface once we need it.

### POST /pins/:cid

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

## Getting Started

PR's are deployed automatically to `https://<pr#>.pickup.dag.haus`. The `main` branch is deployed to https://staging.pickup.dag.haus and staging builds are promoted to prod manually via the UI at https://console.seed.run/dag-house/pickup

To work on this codebase you need:
- node >= 16
- An AWS account with the AWS CLI configured locally
- Copy `.env.tpl` to `.env.local` and set `CLUSTER_BASIC_AUTH_TOKEN` with a base64 encoded user:pass string.
- Install the deps with `npm i`

Deploy dev services to your aws account and start dev console

```console
npm start
```

See: https://docs.sst.dev for more info on how things get deployed.

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


## Integration with Elastic Provider

see: https://github.com/ipfs-elastic-provider/ipfs-elastic-provider

### Option 1 - use uploads v2

The initial /pins lambda asks web3.storage for a signed s3 upload url instead of picking the bucket to write to itself.
- Means we write the CAR directly into Elastic Provider. But we need something to say "upload complete" so that we update the PinRequests DynamoDB table... This could be done by pickup once the upload is complete. We would at that point have the full CAR, so we could mark it as pinned at that point, but it won't be available until later, after the elastic provider has processed it.


### Option 2 - inform Elastic provider on upload complete

Send a message on the indexer SQS topic from our lambda when the CAR is written to our s3 bucket.

## Questions

Rate limiting per user!
Thing to check before adding to the SQS queue
- do we already have the thing? Check with elastic provider.
- does the user have too many pin requests pending already.
- is the queue long? drop reqs at some threshold.


## References

> When a consumer (component 2) is ready to process messages, it consumes messages from the queue, and message A is returned. While message A is being processed, it remains in the queue and isn't returned to subsequent receive requests for the duration of the visibility timeout.
>
> The consumer (component 2) deletes message A from the queue to prevent the message from being received and processed again when the visibility timeout expires. 
> 
>https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-architecture.html

> If you don't know how long it takes to process a message, create a heartbeat for your consumer process: Specify the initial visibility timeout (for example, 2 minutes) and then—as long as your consumer still works on the message—keep extending the visibility timeout by 2 minutes every minute.
>
> https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/working-with-messages.html

> Worker Services allow you to implement asynchronous service-to-service communication with pub/sub architectures. Your microservices in your application can publish events to Amazon SNS topics that can then be consumed by a "Worker Service".
>
> https://aws.github.io/copilot-cli/docs/concepts/services/#request-driven-web-service

> A Backend Service on AWS Copilot a one-click deployment of a gateway as a "backend service" (autoscaling at Fargate Spot pricing, each node has a port open so is a full participant in libp2p, 200G ssd for the datastore, 4cores and up to 30G RAM, no LB though - dns based discovery for client-side load balancing).
>
> https://github.com/ipfs-shipyard/go-ipfs-docker-examples/tree/main/gateway-copilot-backend-service


[pinning service api]: https://ipfs.github.io/pinning-services-api-spec/


## aws notes

remove a bunch of buckets by bucket prefix name

```sh
# danger! will delete things!
aws s3 ls | grep olizilla-pickup | awk '{print "s3://"$3}' | xargs -n 1 -I {} aws s3 rb {} --force;
```
