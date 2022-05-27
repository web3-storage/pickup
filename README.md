![](https://ipfs.io/ipfs/bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/ep-logo.svg)

# Pickup 🛻

**WIP - README DRIVEN DEV - NOT A THING YET**

Fetch content from IPFS as a CAR and push it to S3. AKA an elastic [pinning service api]. 🌐📌 

## Getting started

Requires **node.js v16** or higher. Install the dependencies with `npm i`.

Start the api in dev mode:

```console
$ npm start
16:33:45 ✨ Server listening at http://127.0.0.1:3000
```

## The plan

Lambda + Dynamo + SQS + ECS impl of the pinning service api

The pinning service frontend is a lambda:

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

## References

> When a consumer (component 2) is ready to process messages, it consumes messages from the queue, and message A is returned. While message A is being processed, it remains in the queue and isn't returned to subsequent receive requests for the duration of the visibility timeout.
>
> The consumer (component 2) deletes message A from the queue to prevent the message from being received and processed again when the visibility timeout expires.
– https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-architecture.html

> If you don't know how long it takes to process a message, create a heartbeat for your consumer process: Specify the initial visibility timeout (for example, 2 minutes) and then—as long as your consumer still works on the message—keep extending the visibility timeout by 2 minutes every minute.
– https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/working-with-messages.html

> Worker Services allow you to implement asynchronous service-to-service communication with pub/sub architectures. Your microservices in your application can publish events to Amazon SNS topics that can then be consumed by a "Worker Service". 
– https://aws.github.io/copilot-cli/docs/concepts/services/#request-driven-web-service

> A Backend Service on AWS Copilot a one-click deployment of a gateway as a "backend service" (autoscaling at Fargate Spot pricing, each node has a port open so is a full participant in libp2p, 200G ssd for the datastore, 4cores and up to 30G RAM, no LB though - dns based discovery for client-side load balancing).
– https://github.com/ipfs-shipyard/go-ipfs-docker-examples/tree/main/gateway-copilot-backend-service


[pinning service api]: https://ipfs.github.io/pinning-services-api-spec/
