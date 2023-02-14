![](https://ipfs.io/ipfs/bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/ep-logo.svg)

# Validator worker 🛻

When a file is uploaded on the temporary S3 bucket, an event is added on the SQS Queue.
The Validator process listen to the Queue and for each `car` in the messages exec a validation.
If the `car` is valid, the file is coied from the 

## Getting started

Requires **node.js v16** or higher. Install the dependencies with `npm i`.
