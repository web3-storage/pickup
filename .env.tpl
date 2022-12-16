# Elastic IPFS Multiaddr
CLUSTER_IPFS_ADDR="/dns4/elastic.dag.house/tcp/443/wss/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm"

# Base64 encoded user:pass string
CLUSTER_BASIC_AUTH_TOKEN="???"

# Indexer base url (The example below is referred to staging)
INDEXER_BASE_URL="https://nft.storage.ipfscluster.io/api"

# Indexer base url
# 0 -> all request to Indexer
# 100 -> All request to Pickup
# values in between the balancer is applied (eg. 15 -> 15% of the request to Pickup, 85% to Indexer)
BALANCER_RATE=10

# uncomment to try out deploying the api under a custom domain.
# the value should match a hosted zone configured in route53 that your aws account has access to.
# HOSTED_ZONE=pickup.dag.haus
