/** Actual response envelope for fetch-level fixtures; correlation comes from the outgoing request. */
export function currentHttpResponse (options, body, init = {}) {
  const requestId = new Headers(options.headers).get('X-Request-Id')
  if (!requestId) throw new Error('Fixture request must carry X-Request-Id')
  const headers = new Headers(init.headers)
  headers.set('X-Request-Id', requestId)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify({ protocolVersion: 1, requestId, code: body.code,
    msg: body.msg ?? (body.code === 'E0' ? 'ok' : 'rejected'), data: body.data ?? null }), { ...init, headers })
}
