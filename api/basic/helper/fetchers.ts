import * as querystring from 'node:querystring'
import fetch from 'node-fetch'

import { ClusterAddResponse, ClusterStatusResponse } from '../schema.js'

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
  const result = await fetch(myURL.href, { method: 'POST', headers: { Authorization: `Basic ${token}` } })

  return { statusCode: result.status, body: (await result.json()) as ClusterAddResponse }
}

export async function fetchGetPin ({
  cid,
  endpoint,
  token,
  isInternal = false
}: FetchGetPinParams): Promise<GetPinResult> {
  const baseUrl = (new URL(endpoint))
  const myURL = new URL(`${baseUrl.pathname !== '/' ? baseUrl.pathname : ''}${isInternal ? '/internal' : ''}/pins/${cid}`, baseUrl.origin)
  const result = await fetch(myURL.href, { method: 'GET', headers: { Authorization: `Basic ${token}` } })

  return { statusCode: result.status, body: (await result.json()) as ClusterStatusResponse }
}
