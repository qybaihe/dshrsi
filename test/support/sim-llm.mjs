// A scriptable Messages-compatible model endpoint for keyless end-to-end runs.
// The real DeepSeek adapter talks to it through DEEPSEEK_BASE_URL, so the whole
// harness stack below the provider is exercised unchanged.
//
// A policy is a function of the parsed request and returns what the simulated
// model says next: { text?, toolCalls?: [{ name, input }] }.
import http from 'node:http'

/** Flattens Messages `content` (string or block array) into plain text. */
export function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool_result') return contentText(block.content)
    return ''
  }).join('\n')
}

/** System prompt as one string. */
export function systemText(body) {
  return contentText(body.system)
}

/** Every tool result in the conversation, oldest first: { toolUseId, text, isError }. */
export function toolResults(body) {
  const out = []
  for (const message of body.messages ?? []) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        out.push({ toolUseId: block.tool_use_id, text: contentText(block.content), isError: block.is_error === true })
      }
    }
  }
  return out
}

/** Every tool call the assistant made, oldest first: { id, name, input }. */
export function toolCalls(body) {
  const out = []
  for (const message of body.messages ?? []) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === 'tool_use') out.push({ id: block.id, name: block.name, input: block.input })
    }
  }
  return out
}

/** Text of every user-role message that is not a tool result, oldest first. */
export function userTexts(body) {
  const out = []
  for (const message of body.messages ?? []) {
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') { out.push(message.content); continue }
    for (const block of message.content ?? []) if (block.type === 'text') out.push(block.text)
  }
  return out
}

/** Whole conversation as text, for coarse `includes` checks in policies. */
export function transcript(body) {
  return (body.messages ?? []).map(message => contentText(message.content)).join('\n')
}

function sse(response, payload) {
  response.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`)
}

function streamReply(response, reply, callSeq) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  sse(response, {
    type: 'message_start',
    message: { id: `sim-${callSeq}`, type: 'message', role: 'assistant', model: 'sim-model', content: [], usage: { input_tokens: 10, output_tokens: 0 } },
  })
  let index = 0
  if (reply.text) {
    sse(response, { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
    sse(response, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: reply.text } })
    sse(response, { type: 'content_block_stop', index })
    index += 1
  }
  const calls = reply.toolCalls ?? []
  calls.forEach((call, position) => {
    sse(response, { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `sim-call-${callSeq}-${position}`, name: call.name, input: {} } })
    sse(response, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input ?? {}) } })
    sse(response, { type: 'content_block_stop', index })
    index += 1
  })
  sse(response, { type: 'message_delta', delta: { stop_reason: calls.length > 0 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } })
  sse(response, { type: 'message_stop' })
  response.end()
}

/**
 * Starts the endpoint.
 * @param {(body: object, info: { seq: number }) => object | Promise<object>} policy
 * @returns {Promise<{ baseUrl: string, requests: object[], setPolicy: Function, close: () => Promise<void> }>}
 */
export async function startSimLlm(policy) {
  const requests = []
  let current = policy
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', async () => {
      if (request.method !== 'POST' || !request.url.endsWith('/messages')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: `no route ${request.method} ${request.url}`, type: 'not_found_error' } }))
        return
      }
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: `bad json: ${error.message}`, type: 'invalid_request_error' } }))
        return
      }
      const seq = requests.length + 1
      requests.push(body)
      try {
        const reply = await current(body, { seq })
        streamReply(response, reply, seq)
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: `sim policy threw: ${error.stack ?? error}`, type: 'api_error' } }))
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    setPolicy(next) { current = next },
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}
