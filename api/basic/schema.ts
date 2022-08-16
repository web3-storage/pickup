export interface Response {
  statusCode: number
  body: any
}

export interface Pin {
  cid: string
  status: 'queued' | 'pinning' | 'pinned' | 'failed' | 'unpinned'
  created: string
}

export interface PeerMapValue {
  'peername': string
  'ipfs_peer_id': string
  'ipfs_peer_addresses': string[]
  'status': Pin['status']
  'timestamp': string
  'error': string
  'attempt_count': number
  'priority_pin': boolean
}

export interface ClusterStatusResponse {
  'cid': string
  'name': ''
  'allocations': []
  'origins': []
  'created': string
  'metadata': null
  'peer_map': Record<string, PeerMapValue>
}

export interface ClusterAddResponse {
  replication_factor_min: -1
  replication_factor_max: -1
  name: string
  mode: 'recursive'
  shard_size: 0
  user_allocations: null
  expire_at: '0001-01-01T00:00:00Z' // we don't support exiring pins, so always return this value.
  metadata: {}
  pin_update: null
  origins: string[]
  cid: string
  type: 'pin'
  allocations: []
  max_depth: -1
  reference: null
  timestamp: string // "2022-08-11T12:39:50.772359472Z"
}
