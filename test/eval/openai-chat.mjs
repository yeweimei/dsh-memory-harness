/** Minimal OpenAI-compatible chat helper for the evaluation reader/judge. */

function endpointFor(baseURL) {
  const trimmed = String(baseURL ?? '').replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

/**
 * @param {{ baseURL: string, model: string, apiKey?: string, system?: string, user: string, maxTokens?: number, temperature?: number, timeoutMs?: number }} input
 */
export async function chatComplete({ baseURL, model, apiKey = '', system, user, maxTokens = 1024, temperature = 0, timeoutMs = 120000, enableThinking = false }) {
  const startedAt = Date.now()
  const response = await fetch(endpointFor(baseURL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      chat_template_kwargs: { enable_thinking: enableThinking },
      messages: [
        ...(system === undefined || system === '' ? [] : [{ role: 'system', content: system }]),
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`chat endpoint returned non-JSON (${response.status}): ${text.slice(0, 300)}`)
  }
  if (!response.ok) throw new Error(`chat endpoint returned ${response.status}: ${JSON.stringify(parsed).slice(0, 400)}`)
  const message = parsed?.choices?.[0]?.message
  const content = typeof message?.content === 'string' ? message.content : ''
  return {
    content,
    reasoning: typeof message?.reasoning_content === 'string' ? message.reasoning_content : '',
    finishReason: parsed?.choices?.[0]?.finish_reason ?? null,
    usage: parsed?.usage ?? null,
    latencyMs: Date.now() - startedAt,
    raw: parsed,
  }
}
