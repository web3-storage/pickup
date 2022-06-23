import { nanoid } from 'nanoid'
import { OpenAPIBackend } from 'openapi-backend'
import { Context as OAContext } from 'openapi-backend/backend'
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, Context as AWSContext } from 'aws-lambda'
import { components, paths } from '../schema'

type PinResults = components['schemas']['PinResults']
type PinStatus = components['schemas']['PinStatus']
type Pin = components["schemas"]["Pin"]
type PinQuery = paths["/pins"]["get"]["parameters"]["query"]

// used to filter props when querying dynamodb
const PinStatusAttrs = ['requestid', 'status', 'created', 'pin', 'delegates', 'info']

const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

function getUserId(accessToken: string) {
  // TODO: map access token to user id
  return accessToken
}

// gross. i have no idea how they expect you to write an IN query with this shit.
function toInFilter(arr: string[]) {
  const Expresssion = arr.map(k => `:${k}`).join(', ')
  let Values = {}
  // @ts-ignore
  arr.forEach(k => Values[`:${k}`] = k)
  return { Expresssion, Values }
}

// GET /pins
export async function getPins (c: OAContext, event: APIGatewayProxyEventV2, context: AWSContext) {
  const params = c.request.query as PinQuery
  const status = Array.isArray(params.status) ? params.status : Array.of(params.status || 'pinned')
  const userid = getUserId(c.security.accessToken)
  const query = { 
    TableName: process.env.TABLE_NAME,
    // gotta sidestep dynamo reserved words!?
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: { 
      ":u": userid,
      ...toInFilter(status).Values
    },
    KeyConditionExpression: "userid = :u",
    FilterExpression: `#status IN (${toInFilter(status).Expresssion})`,
    ScanIndexForward: false, // most recent pins first plz
    Limit: Number(params.limit) || 10
  }
  console.log(query)
  try {
    const res = await dynamoDb.send(new QueryCommand(query))
    const body: PinResults = { 
      count: res.Count || 0, 
      results: res.Items as PinStatus[]
    }
    return { statusCode: 200, body }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR'  } } } 
  }
}

// POST /pins
export async function addPin (c: OAContext, event: APIGatewayProxyEventV2, context: AWSContext) {
  const pin = c.request.requestBody as Pin
  // TODO: map access token to user id
  const userid = c.security.accessToken
  
  const status: PinStatus = {
    requestid: `${Date.now()}-${nanoid(13)}`,
    status: 'queued',
    created: new Date().toISOString(),
    pin,
    delegates: [],
    info: {}
  }

  try {
    await dynamoDb.send(new PutCommand({ 
      TableName: process.env.TABLE_NAME, 
      Item: {
        ...status,
        userid
      } 
    }))
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR'  } } } 
  }
  // TODO: put it in SQS
  return { statusCode: 200, body: status }
}

// GET /pins/{requestid}
export async function getPinByRequestId (c: OAContext, event: APIGatewayProxyEventV2, context: AWSContext) {
  const { requestid } = c.request.params
  const userid = getUserId(c.security.accessToken)
  try {
    const res = await dynamoDb.send(new GetCommand({ 
      TableName: process.env.TABLE_NAME, 
      Key: { userid, requestid },
      AttributesToGet: PinStatusAttrs
    }))
    console.log(requestid, userid, res)
    if (res.Item) {
      return { statusCode: 200, body: res.Item }
    }
    // TODO: validate Item?
    return { statusCode: 404, body: { error: { reason: 'NOT_FOUND' }}}
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: { error: { reason: 'INTERNAL_SERVER_ERROR'  } } }
  }
}

// POST /pins/{requestid}
export async function replacePinByRequestId (c: OAContext, event: APIGatewayProxyEventV2, context: AWSContext) {
  const body = { operationId: c.operation.operationId }
  return { statusCode: 501, body}
}

// DELETE /pins/{requestid}
export async function deletePinByRequestId (c: OAContext, event: APIGatewayProxyEventV2, context: AWSContext) {
  const body = { operationId: c.operation.operationId }
  return { statusCode: 501, body}
}

export async function unauthorizedHandler (c: OAContext) {
  // @ts-ignore
  const body = c.api.document.components?.examples?.UnauthorizedExample?.value
  return { statusCode: 401, body }
}

export async function validationFail (c: OAContext) {
  const details = c.validation.errors?.map(err => [err.instancePath, err.message].filter(x => !!x).join(' ')).join(', ')
  const body = { error: { reason:'BAD_REQUEST', details }}
  return { statusCode: 400, body }
}

export async function notFound (c: OAContext) {
  // @ts-ignore
  const body = c.api.document.components?.examples?.NotFoundExample?.value

  return { statusCode: 404, body }
}

const api = new OpenAPIBackend({ 
  definition: './ipfs-pinning-service.yaml', 
  // quick means lazily compile ajv validators as needed.
  quick: true,
  // have to add date-time validator, taken from https://github.com/anttiviljami/openapi-backend/issues/280#issuecomment-1017481557
  customizeAjv: (ajv, ajvOpts, validationContext) => {
    let dtFormat = {
        type: 'string',
        validate: /^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i,
    }
    ajv.addFormat("date-time", dtFormat as any)
    return ajv;
  }
});

api.register({
  addPin,
  getPins,
  getPinByRequestId,
  replacePinByRequestId,
  deletePinByRequestId,
  unauthorizedHandler,
  validationFail,
  notFound,
})

api.registerSecurityHandler('accessToken', function (c) {
  const authHeader = c.request.headers['authorization']
  if (!authHeader) {
    throw new Error('Missing authorization header')
  }
  if (Array.isArray(authHeader)) {
    throw new Error('Too many authorization headers')
  }
  const token = authHeader.replace('Bearer ', '')
  // TODO: verify tokens!
  return token === 'super-duper-admin' ? token : false
})

// the main export called by lambda, maps lamda things to openapi-backend things
export const handler: APIGatewayProxyHandlerV2 = async (event, awsContext) => {
  const openApiContext = {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.rawQueryString,
    body: event.body,
    headers: event.headers || {}
  }
  // @ts-ignore the openapi-backend types need updating to deal with v2 where value could be undefined.
  return api.handleRequest(openApiContext, event, awsContext)
}
