import { ClusterStatusResponse, Pin } from '../schema'

/**
 * Hardcodes much of a cluster shaped response as if it was a single node cluster
 * with just elastic-ipfs as it's single backing node.
 *
 * TODO: Once we know that EP is providing the CID, we update the status to pinned in our db.
 *
 * NOTE: This API is "temporary" to allow us to swap in pickup for cluster. A simpler, non-cluster compatible api can be used onced we are happy that it's a good idea.
 */
export function toGetPinResponse (
  cid: string,
  pin?: Pin,
  ipfsAddr = '/dns4/elastic.dag.house/tcp/443/wss/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm',
  ipfsPeerId = ipfsAddr.split('/').at(-1)
): ClusterStatusResponse {
  if (ipfsPeerId === undefined) {
    throw new Error('CLUSTER_IPFS_ADDR must be a valid multiaddr')
  }
  return {
    cid: cid,
    name: '',
    allocations: [],
    origins: [],
    created: pin?.created ?? new Date().toISOString(),
    metadata: null,
    peer_map: {
      // Fake cluster ID to give correct shape to output, not expected to be used. dotStorge dont care.
      '12D3KooWArSKMUUeLk3z2m5LKyb9wGyFL1BtWCT7Gq7Apoo77PUR': {
        peername: 'elastic-ipfs',
        ipfs_peer_id: ipfsPeerId,
        ipfs_peer_addresses: [
          ipfsAddr
        ],
        status: pin?.status ?? 'unpinned',
        timestamp: new Date().toISOString(),
        error: '',
        attempt_count: 0,
        priority_pin: false
      }
    }
  }
}
