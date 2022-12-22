import * as querystring from 'node:querystring'
import fetch from 'node-fetch'

import { ClusterAddResponse, ClusterStatusResponse } from '../schema.js'
import { logger } from './logger.js'

export interface AddPinResult {
  statusCode: number
  body: ClusterAddResponse
}

export interface GetPinResult {
  statusCode: number
  body: ClusterStatusResponse
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

export async function fetchAddPin ({
  cid,
  endpoint,
  token,
  origins,
  isInternal = false
}: FetchAddPinParams): Promise<AddPinResult> {
  const baseUrl = (new URL(endpoint))
  const query = (origins.length > 0) ? `?${querystring.stringify({ origins: origins.join(',') })}` : ''
  const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins/${cid}${query}`, baseUrl.origin)
  logger.trace({ endpoint, isInternal, href: myURL.href }, 'fetchAddPin')
  const result = await fetch(myURL.href, { method: 'POST', headers: { Authorization: `Basic ${token}` } })
  const resultJSON = (await result.json()) as ClusterAddResponse
  logger.trace({ endpoint, isInternal, href: myURL.href, result: resultJSON, statusCode: result.status }, 'fetchAddPin SUCCESS')
  return { statusCode: result.status, body: resultJSON }
}

export async function fetchGetPin ({
  cid,
  endpoint,
  token,
  isInternal = false
}: FetchGetPinParams): Promise<GetPinResult> {
  const baseUrl = (new URL(endpoint))
  const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins/${cid}`, baseUrl.origin)
  logger.trace({ endpoint, isInternal, href: myURL.href }, 'fetchGetPin')
  const result = await fetch(myURL.href, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

  const resultJSON = (await result.json()) as ClusterStatusResponse
  logger.trace({ endpoint, isInternal, href: myURL.href, result: resultJSON, statusCode: result.status }, 'fetchGetPin SUCCESS')

  return { statusCode: result.status, body: resultJSON }
}
