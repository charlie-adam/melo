import { request } from '../bridge/client'
import type { ApiError, Endpoint } from '../bridge/protocol'
import type { ApiRequest } from './requests'

export class ApiCallError extends Error {
  readonly error: ApiError
  constructor(error: ApiError) {
    super(`api.call failed: ${error.kind}${error.status ? ` ${error.status}` : ''}`)
    this.error = error
  }
}

/** Sends a built request through Swift and resolves with the raw InnerTube JSON, or rejects with an ApiCallError. */
export async function call(req: ApiRequest): Promise<unknown> {
  const result = await request('api.call', { endpoint: req.endpoint as Endpoint, body: req.body })
  if (!result.ok) throw new ApiCallError(result.error)
  return result.json
}
