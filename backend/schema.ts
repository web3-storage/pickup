import { components, paths } from './schema-gen'
export type PinResults = components['schemas']['PinResults']
export type PinStatus = components['schemas']['PinStatus']
export type Pin = components["schemas"]["Pin"]
export type PinQuery = paths["/pins"]["get"]["parameters"]["query"]
export type Status = components["schemas"]["Status"]