import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'
import { createServer as createViteServer } from 'vite'

dotenv.config()
dotenv.config({ path: '.env.local' })

type GenerationRequest = {
  prompt?: string
  context?: string
  negativePrompt?: string
  style?: string
  model?: string
  aspectRatio?: string
  durationSeconds?: number
  seed?: string
}

type ConfigPayload = {
  videoApiUrlConfigured: boolean
  videoApiKeyConfigured: boolean
  videoApiKeyHeader: string
  videoApiModel: string | null
  providerLabel: string
}

type NormalizedVideoResponse = {
  videoUrl: string | null
  jobId: string | null
  status: string | null
  rawResponse: unknown
  location: string | null
  contentType: string | null
}

const app = express()
const isProduction = process.env.NODE_ENV === 'production' || path.basename(process.argv[1] || '') === 'server.js'
const port = Number(process.env.PORT) || 3000

app.use(express.json({ limit: '2mb' }))

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function isOpenAIVideoEndpoint(apiUrl: string) {
  try {
    const { hostname, pathname } = new URL(apiUrl)
    return hostname === 'api.openai.com' && pathname.startsWith('/v1/videos')
  } catch {
    return false
  }
}

function mapAspectRatioToSize(aspectRatio: string, model: string) {
  const isPro = /pro/i.test(model)

  switch (aspectRatio) {
    case '16:9':
      return isPro ? '1920x1080' : '1280x720'
    case '9:16':
      return isPro ? '1080x1920' : '720x1280'
    case '1:1':
      return '1024x1024'
    default:
      return null
  }
}

function mapDurationToOpenAISecs(durationSeconds?: number) {
  if (!Number.isFinite(durationSeconds)) {
    return '8'
  }

  const duration = Number(durationSeconds)
  if (duration <= 4) {
    return '4'
  }

  if (duration <= 8) {
    return '8'
  }

  return '12'
}

function composeOpenAIPrompt(body: GenerationRequest) {
  const prompt = body.prompt?.trim() || ''
  const style = body.style?.trim()
  const context = body.context?.trim()
  const negativePrompt = body.negativePrompt?.trim()

  return [
    prompt,
    style ? `Style: ${style}.` : '',
    context ? `Context: ${context}.` : '',
    negativePrompt ? `Avoid: ${negativePrompt}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildAuthHeaderValue(prefix: string | undefined, apiKey: string) {
  const normalizedPrefix = prefix?.trim() || ''

  if (!normalizedPrefix) {
    return apiKey
  }

  if (/^(bearer|basic)$/i.test(normalizedPrefix)) {
    return `${normalizedPrefix} ${apiKey}`
  }

  return `${normalizedPrefix}${apiKey}`
}

function buildOpenAIVideoResourceUrl(apiUrl: string, videoId: string, suffix?: string) {
  const url = new URL(apiUrl)
  const basePath = url.pathname.replace(/\/$/, '').replace(/\/videos$/, '')
  url.pathname = `${basePath}/videos/${videoId}${suffix ? `/${suffix}` : ''}`
  return url.toString()
}

function buildOpenAIVideoPayload(body: GenerationRequest, model: string) {
  const size = mapAspectRatioToSize(body.aspectRatio?.trim() || '16:9', model)
  const payload: Record<string, string | number> = {
    model,
    prompt: composeOpenAIPrompt(body),
  }

  if (size) {
    payload.size = size
  }

  if (Number.isFinite(body.durationSeconds)) {
    payload.seconds = mapDurationToOpenAISecs(body.durationSeconds)
  }

  return payload
}

async function fetchOpenAIVideoResource(apiUrl: string, apiKey: string | undefined, apiKeyHeader: string, apiKeyPrefix: string | undefined, videoId: string, suffix?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
  }

  if (apiKey) {
    headers[apiKeyHeader] = buildAuthHeaderValue(apiKeyPrefix, apiKey)
  }

  return fetch(buildOpenAIVideoResourceUrl(apiUrl, videoId, suffix), {
    method: 'GET',
    headers,
  })
}

function extractVideoUrl(payload: unknown): string | null {
  if (!payload) {
    return null
  }

  if (typeof payload === 'string') {
    return isHttpUrl(payload) ? payload : null
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = extractVideoUrl(item)
      if (candidate) {
        return candidate
      }
    }

    return null
  }

  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return pickString(
      record.videoUrl,
      record.video_url,
      record.url,
      record.outputUrl,
      record.fileUrl,
      record.previewUrl,
      record.assetUrl,
      extractVideoUrl(record.data),
      extractVideoUrl(record.result),
      extractVideoUrl(record.output),
    )
  }

  return null
}

function extractJobId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const record = payload as Record<string, unknown>
  return pickString(
    record.jobId,
    record.job_id,
    record.id,
    record.requestId,
    record.request_id,
    record.videoId,
    record.video_id,
    record.generationId,
    record.generation_id,
  )
}

function normalizeResponse(payload: unknown, headers: Headers): NormalizedVideoResponse {
  return {
    videoUrl: extractVideoUrl(payload),
    jobId: extractJobId(payload),
    status: payload && typeof payload === 'object' && !Array.isArray(payload) ? pickString((payload as Record<string, unknown>).status) : null,
    rawResponse: payload,
    location: headers.get('location'),
    contentType: headers.get('content-type'),
  }
}

function getConfig(): ConfigPayload {
  const videoApiKeyHeader = process.env.VIDEO_API_KEY_HEADER?.trim() || 'Authorization'

  return {
    videoApiUrlConfigured: Boolean(process.env.VIDEO_API_URL?.trim()),
    videoApiKeyConfigured: Boolean(process.env.VIDEO_API_KEY?.trim()),
    videoApiKeyHeader,
    videoApiModel: process.env.VIDEO_MODEL?.trim() || null,
    providerLabel: process.env.VIDEO_PROVIDER?.trim() || 'Custom video API',
  }
}

app.get('/api/config', (_req, res) => {
  res.json(getConfig())
})

app.post('/api/generate-video', async (req, res) => {
  const body = (req.body || {}) as GenerationRequest
  const prompt = body.prompt?.trim() || ''

  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required.' })
    return
  }

  const apiUrl = process.env.VIDEO_API_URL?.trim()
  if (!apiUrl) {
    res.status(503).json({
      error: 'VIDEO_API_URL is missing. Configure it in .env.local to connect the generator to your video provider.',
    })
    return
  }

  const apiKey = process.env.VIDEO_API_KEY?.trim()
  const apiKeyHeader = process.env.VIDEO_API_KEY_HEADER?.trim() || 'Authorization'
  const apiKeyPrefix = process.env.VIDEO_API_KEY_PREFIX ?? 'Bearer '
  const model = body.model?.trim() || process.env.VIDEO_MODEL?.trim() || 'sora-2'

  const payload = isOpenAIVideoEndpoint(apiUrl)
    ? buildOpenAIVideoPayload(body, model)
    : {
        model,
        prompt,
        context: body.context?.trim() || '',
        negativePrompt: body.negativePrompt?.trim() || '',
        style: body.style?.trim() || '',
        aspectRatio: body.aspectRatio?.trim() || '16:9',
        durationSeconds: Number.isFinite(body.durationSeconds) ? Number(body.durationSeconds) : 8,
        seed: body.seed?.trim() || '',
        metadata: {
          app: 'Sora 2 Video Generator',
          source: 'local-express-proxy',
          timestamp: new Date().toISOString(),
        },
      }

  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    'Content-Type': 'application/json',
  }

  if (apiKey) {
    headers[apiKeyHeader] = buildAuthHeaderValue(apiKeyPrefix, apiKey)
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const contentType = response.headers.get('content-type') || ''
    const text = await response.text()
    const parsedBody = contentType.includes('application/json') ? safeJsonParse(text) ?? text : text
    const normalized = normalizeResponse(parsedBody, response.headers)

    if (!response.ok) {
      const providerMessage =
        typeof parsedBody === 'object' && parsedBody && !Array.isArray(parsedBody)
          ? pickString((parsedBody as Record<string, unknown>).error, (parsedBody as Record<string, unknown>).message)
          : null

      res.status(response.status).json({
        ok: false,
        error: providerMessage || `Video provider returned ${response.status}.`,
        providerStatus: response.status,
        request: payload,
        ...normalized,
      })
      return
    }

    res.status(response.status).json({
      ok: true,
      providerStatus: response.status,
      request: payload,
      ...normalized,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(502).json({
      error: `Failed to reach the configured video API: ${message}`,
    })
  }
})

app.get('/api/videos/:videoId', async (req, res) => {
  const apiUrl = process.env.VIDEO_API_URL?.trim()
  if (!apiUrl) {
    res.status(503).json({ error: 'VIDEO_API_URL is missing.' })
    return
  }

  const apiKey = process.env.VIDEO_API_KEY?.trim()
  const apiKeyHeader = process.env.VIDEO_API_KEY_HEADER?.trim() || 'Authorization'
  const apiKeyPrefix = process.env.VIDEO_API_KEY_PREFIX ?? 'Bearer '

  try {
    const response = await fetchOpenAIVideoResource(apiUrl, apiKey, apiKeyHeader, apiKeyPrefix, req.params.videoId)
    const contentType = response.headers.get('content-type') || ''
    const text = await response.text()
    const parsedBody = contentType.includes('application/json') ? safeJsonParse(text) ?? text : text

    res.status(response.status).json({
      ok: response.ok,
      providerStatus: response.status,
      ...normalizeResponse(parsedBody, response.headers),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(502).json({ error: `Failed to reach the configured video API: ${message}` })
  }
})

app.get('/api/videos/:videoId/content', async (req, res) => {
  const apiUrl = process.env.VIDEO_API_URL?.trim()
  if (!apiUrl) {
    res.status(503).json({ error: 'VIDEO_API_URL is missing.' })
    return
  }

  const apiKey = process.env.VIDEO_API_KEY?.trim()
  const apiKeyHeader = process.env.VIDEO_API_KEY_HEADER?.trim() || 'Authorization'
  const apiKeyPrefix = process.env.VIDEO_API_KEY_PREFIX ?? 'Bearer '

  try {
    const response = await fetchOpenAIVideoResource(apiUrl, apiKey, apiKeyHeader, apiKeyPrefix, req.params.videoId, 'content')

    if (!response.ok || !response.body) {
      const contentType = response.headers.get('content-type') || ''
      const text = await response.text()
      const parsedBody = contentType.includes('application/json') ? safeJsonParse(text) ?? text : text
      res.status(response.status).json({
        ok: false,
        providerStatus: response.status,
        error: typeof parsedBody === 'object' && parsedBody && !Array.isArray(parsedBody)
          ? pickString((parsedBody as Record<string, unknown>).error, (parsedBody as Record<string, unknown>).message) || 'Video content is not ready.'
          : 'Video content is not ready.',
        rawResponse: parsedBody,
      })
      return
    }

    res.status(response.status)
    const contentType = response.headers.get('content-type')
    const contentDisposition = response.headers.get('content-disposition')
    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }
    if (contentDisposition) {
      res.setHeader('Content-Disposition', contentDisposition)
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.videoId}.mp4"`)
    }

    await response.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(Buffer.from(chunk))
        },
        close() {
          res.end()
        },
        abort(reason) {
          res.destroy(reason instanceof Error ? reason : undefined)
        },
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(502).json({ error: `Failed to reach the configured video API: ${message}` })
  }
})

async function start() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    })

    app.use(vite.middlewares)
  } else {
    const distDir = path.dirname(fileURLToPath(import.meta.url))
    app.use(express.static(distDir))

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Sora 2 Video Generator running on http://localhost:${port}`)
  })
}

void start()