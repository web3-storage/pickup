import * as querystring from 'node:querystring'
import fetch, { RequestInit, Response } from 'node-fetch'
import retry from 'p-retry'

import { ClusterAddResponseBody, ClusterGetResponseBody } from '../schema.js'
import { logger } from './logger.js'

export interface FetchAddPinParams {
  cid: string
  endpoint: string
  token: string
  origins: string[]
  isInternal?: boolean
}

export interface FetchGetPinParams {
  cid: string
  endpoint: string
  token: string
  isInternal?: boolean
}

export interface FetchGetPinsParams {
  cids: string[]
  endpoint: string
  token: string
  isInternal?: boolean
}

/**
 * Retry if fetch throws or there was a server-side error
 */
async function fetchWithRetry (url: URL, init?: RequestInit): Promise<Response> {
  async function fetchAndCheckStatus (url: URL, init?: RequestInit): Promise<Response> {
    const res = await fetch(url.href, init)
    if (res.status >= 500) {
      throw new Error(res.statusText)
    }
    return res
  }

  return await retry(async () => await fetchAndCheckStatus(url, init), {
    retries: 5,
    randomize: true,
    onFailedAttempt: ({ attemptNumber, retriesLeft, message }) => logger.debug({ code: 'FETCH_RETRY', url, attemptNumber, retriesLeft }, `Fetch failed: ${message}`)
  })
}

export async function fetchAddPin ({
  cid,
  endpoint,
  token,
  origins,
  isInternal = false
}: FetchAddPinParams): Promise<ClusterAddResponseBody> {
  try {
    const baseUrl = (new URL(endpoint))
    const query = (origins.length > 0) ? `?${querystring.stringify({ origins: origins.join(',') })}` : ''
    const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins/${cid}${query}`, baseUrl.origin)
    logger.trace({ endpoint, isInternal, href: myURL.href }, 'fetchAddPin')
    const result = await fetchWithRetry(myURL, { method: 'POST', headers: { Authorization: `Basic ${token}` } })
    const resultJSON = (await result.json()) as ClusterAddResponseBody
    logger.trace({ endpoint, isInternal, href: myURL.href, result: resultJSON, statusCode: result.status }, 'fetchAddPin DONE')

    if (result.status < 300) {
      return resultJSON
    }

    logger.warn({ code: 'FETCH_ADD_PIN', cid, endpoint, url: myURL }, 'Fetch for add pin failed')
  } catch (err) {
    logger.warn({ code: 'FETCH_ADD_PIN', cid, endpoint, err }, 'Fetch for add pin failed')
  }
  throw new Error('FETCH_ADD_PIN')
}

export async function fetchGetPin ({
  cid,
  endpoint,
  token,
  isInternal = false
}: FetchGetPinParams): Promise<ClusterGetResponseBody> {
  try {
    const baseUrl = (new URL(endpoint))
    const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins/${cid}`, baseUrl.origin)
    logger.trace({ endpoint, isInternal, href: myURL.href }, 'fetchGetPin')
    const result = await fetchWithRetry(myURL, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

    const resultJSON = (await result.json()) as ClusterGetResponseBody
    logger.trace({ endpoint, isInternal, href: myURL.href, result: resultJSON, statusCode: result.status }, 'fetchGetPin DONE')

    if (result.status < 300) {
      return resultJSON
    }

    logger.warn({ code: 'FETCH_GET_PIN', cid, endpoint, url: myURL }, 'Fetch for get pin failed')
  } catch (err) {
    logger.warn({ code: 'FETCH_GET_PIN', cid, endpoint, err }, 'Fetch for get pin failed')
  }
  throw new Error('FETCH_GET_PIN')
}

export async function fetchGetPins ({
  cids,
  endpoint,
  token,
  isInternal = false
}: FetchGetPinsParams): Promise<ClusterGetResponseBody[]> {
  try {
    const baseUrl = (new URL(endpoint))
    const query = querystring.stringify({ cids: cids.join(',') })
    const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins?${query}`, baseUrl.origin)
    logger.trace({ endpoint, isInternal, href: myURL.href }, 'fetchGetPins')
    const result = await fetchWithRetry(myURL, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

    const resultText = await result.text()
    logger.trace({ endpoint, isInternal, href: myURL.href, result: resultText, statusCode: result.status }, 'fetchGetPins DONE')

    if (result.status < 300) {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      return resultText.split('\n').filter(row => !!row).map(row => JSON.parse(row))
    }

    logger.warn({ code: 'FETCH_GET_PINS', cids, endpoint, url: myURL }, 'Fetch for get pins failed')
  } catch (err) {
    logger.warn({ code: 'FETCH_GET_PINS', cids, endpoint, err }, 'Fetch for get pins failed')
  }
  throw new Error('FETCH_GET_PIN')
}
