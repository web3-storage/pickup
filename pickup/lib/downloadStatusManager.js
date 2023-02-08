export const STATE_QUEUED = 'queued'
export const STATE_DOWNLOADING = 'downloading'
export const STATE_FAILED = 'failed'
export const STATE_TIMEOUT = 'timeout'
export const STATE_DONE = 'done'

export class DownloadStatusManager {
  constructor () {
    this.status = {}
  }

  reset () {
    this.status = {}
  }

  setStatus (cid, state, size) {
    this.status[cid] = { ...this.status[cid], state }

    if (size !== undefined) {
      this.status[cid] = { ...this.status[cid], size }
    }
  }

  getStatus () {
    return this.status
  }

  isRunning () {
    return Object.keys(this.status).length > 0 && !!Object.values(this.status).find(s => {
      return !['done', 'failed', 'timeout'].includes(s.state)
    })
  }
}
