export interface Response {
  statusCode: number
  body: any
}

export interface Pin {
  cid: string
  status: 'queued' | 'pinning' | 'pinned' | 'failed' | 'unpinned'
  created: string
}

export interface ClusterStatusResponse {
  'cid': string
  'name': ''
  'allocations': []
  'origins': []
  'created': string
  'metadata': null
  'peer_map': {
    '12D3KooWArSKMUUeLk3z2m5LKyb9wGyFL1BtWCT7Gq7Apoo77PUR': {
      'peername': 'elastic-ipfs'
      'ipfs_peer_id': string
      'ipfs_peer_addresses': string[]
      'status': Pin['status']
      'timestamp': string
      'error': ''
      'attempt_count': 0
      'priority_pin': false
    }
  }
}

export interface ClusterAddResponse {
  replication_factor_min: -1
  replication_factor_max: -1
  name: ''
  mode: 'recursive'
  shard_size: 0
  user_allocations: null
  expire_at: '0001-01-01T00:00:00Z'
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
