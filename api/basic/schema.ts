export interface Response {
  statusCode: number
  body: any
}

export interface Pin {
  cid: string
  status: 'queued' | 'pinning' | 'pinned' | 'failed'
  created: string
}
