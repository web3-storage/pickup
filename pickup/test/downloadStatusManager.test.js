import {
  DownloadStatusManager,
  STATE_DONE,
  STATE_DOWNLOADING,
  STATE_FAILED,
  STATE_QUEUED,
  STATE_TIMEOUT
} from '../lib/downloadStatusManager.js'
import test from 'ava'

// verify the lib behaves as expected
test('with no data should not be running', async t => {
  const statusManager = new DownloadStatusManager()
  t.falsy(statusManager.isRunning())
})

test('with a queued value should be running', async t => {
  const statusManager = new DownloadStatusManager()
  statusManager.setStatus('123', STATE_QUEUED)
  t.deepEqual(statusManager.getStatus(), { 123: { state: STATE_QUEUED } })
  t.truthy(statusManager.isRunning())
})

test('set the downloading state with a size', async t => {
  const statusManager = new DownloadStatusManager()
  statusManager.setStatus('123', STATE_QUEUED)
  statusManager.setStatus('123', STATE_DOWNLOADING, 100)
  t.deepEqual(statusManager.getStatus(), { 123: { state: STATE_DOWNLOADING, size: 100 } })
  t.truthy(statusManager.isRunning())
})

test('set the done state with a size', async t => {
  const statusManager = new DownloadStatusManager()
  statusManager.setStatus('123', STATE_QUEUED)
  statusManager.setStatus('123', STATE_DOWNLOADING, 100)
  statusManager.setStatus('123', STATE_DONE, 200)
  t.deepEqual(statusManager.getStatus(), { 123: { state: STATE_DONE, size: 200 } })
  t.falsy(statusManager.isRunning())
})

test('set multiple state and should be running', async t => {
  const statusManager = new DownloadStatusManager()
  statusManager.setStatus('123', STATE_QUEUED)
  statusManager.setStatus('456', STATE_DOWNLOADING, 100)
  statusManager.setStatus('780', STATE_DONE, 200)
  statusManager.setStatus('abc', STATE_FAILED)
  statusManager.setStatus('efg', STATE_TIMEOUT)
  t.deepEqual(statusManager.getStatus(),
    {
      123: {
        state: 'queued'
      },
      456: {
        size: 100,
        state: 'downloading'
      },
      780: {
        size: 200,
        state: 'done'
      },
      abc: {
        state: 'failed'
      },
      efg: {
        state: 'timeout'
      }
    })
  t.truthy(statusManager.isRunning())
})

test('set multiple state and should be not running', async t => {
  const statusManager = new DownloadStatusManager()
  statusManager.setStatus('780', STATE_DONE, 200)
  statusManager.setStatus('abc', STATE_FAILED)
  statusManager.setStatus('efg', STATE_TIMEOUT)
  t.deepEqual(statusManager.getStatus(),
    {
      780: {
        size: 200,
        state: 'done'
      },
      abc: {
        state: 'failed'
      },
      efg: {
        state: 'timeout'
      }
    })
  t.falsy(statusManager.isRunning())
})

test('should reset the state', async t => {
  const statusManager = new DownloadStatusManager()
  statusManager.setStatus('780', STATE_DONE, 200)
  statusManager.setStatus('abc', STATE_FAILED)
  statusManager.setStatus('efg', STATE_TIMEOUT)
  statusManager.reset()
  t.deepEqual(statusManager.getStatus(),
    {})
  t.falsy(statusManager.isRunning())
})
