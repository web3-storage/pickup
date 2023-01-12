import * as querystring from 'node:querystring'
import fetch from 'node-fetch'

import { ClusterAddResponseBody, ClusterGetResponseBody } from '../schema.js'
import { logger } from './logger.js'

export interface AddPinResult {
  statusCode: number
  body: ClusterAddResponse
}

export interface GetPinResult {
  statusCode: number
  body: ClusterStatusResponse
}

export interface GetPinsResult {
  statusCode: number
  body: ClusterStatusResponse[]
}

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
    const result = await fetch(myURL.href, { method: 'POST', headers: { Authorization: `Basic ${token}` } })
    const resultJSON = (await result.json()) as ClusterAddResponseBody
    logger.trace({ endpoint, isInternal, href: myURL.href, result: resultJSON, statusCode: result.status }, 'fetchAddPin DONE')

    if (result.status < 300) {
      return resultJSON
    }
    
    logger.error({ code: 'FETCH_ADD', cid, endpoint, url: myURL }, 'Fetch for add pin failed')
  } catch (err) {
    logger.error({ code: 'FETCH_ADD', cid, endpoint, err }, 'Fetch for add pin failed')
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
    const result = await fetch(myURL.href, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

    const resultJSON = (await result.json()) as ClusterGetResponseBody
    logger.trace({ endpoint, isInternal, href: myURL.href, result: resultJSON, statusCode: result.status }, 'fetchGetPin DONE')

    if (result.status < 300) {
      return resultJSON
    }
    
    logger.error({ code: 'FETCH_GET', cid, endpoint, url: myURL }, 'Fetch for get pin failed')
  } catch (err) {
    logger.error({ code: 'FETCH_GET', cid, endpoint, err }, 'Fetch for get pin failed')
  }
  throw new Error('FETCH_GET_PIN')
}

export async function fetchGetPins ({
  cids,
  endpoint,
  token,
  isInternal = false
}: FetchGetPinsParams): Promise<GetPinsResult> {
  try {
    const baseUrl = (new URL(endpoint))
    const query = querystring.stringify({ cids: cids.join(',') })
    const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins?${query}`, baseUrl.origin)
    logger.trace({ endpoint, isInternal, href: myURL.href }, 'fetchGetPins')
    const result = await fetch(myURL.href, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

    const resultText = await result.text()
    logger.trace({ endpoint, isInternal, href: myURL.href, result: resultText, statusCode: result.status }, 'fetchGetPins SUCCESS')

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    return { statusCode: result.status, body: resultText.split('\n').filter(row => !!row).map(row => JSON.parse(row)) }
  } catch (error) {
    return { statusCode: 500, body: [] }
  }
}
