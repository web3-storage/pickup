![](https://ipfs.io/ipfs/bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/ep-logo.svg)

# Pickup worker 🛻

An SQS Consumer to fetch content from IPFS as a CAR and push it to S3.

Deployed to ECS with a go-ipfs sidecar container to do the work of finding the content.

## Getting started

Requires **node.js v16** or higher. Install the dependencies with `npm i`.

Set required ENV variables by copying the .env.tpl to .env and filling out

```
# URL for an IPFS RPC API
IPFS_API_URL="http://127.0.0.1:5001"

# Set and uncomment the below
AWS_REGION="us-east-2"
AWS_SECRET_ACCESS_KEY=
AWS_ACCESS_KEY_ID=
```

Start the api in dev mode:

```console
$ npm start
```

