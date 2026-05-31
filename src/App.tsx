import { useEffect, useMemo, useState, type FormEvent } from 'react'

type ConfigState = {
  videoApiUrlConfigured: boolean
  videoApiKeyConfigured: boolean
  videoApiKeyHeader: string
  videoApiModel: string | null
  providerLabel: string
}

type GenerateResponse = {
  ok?: boolean
  providerStatus?: number
  videoUrl?: string | null
  jobId?: string | null
  status?: string | null
  location?: string | null
  contentType?: string | null
  rawResponse?: unknown
  error?: string
}

function extractProviderErrorMessage(response: GenerateResponse) {
  if (response.error) {
    return response.error
  }

  const raw = response.rawResponse
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const record = raw as Record<string, unknown>
  const errorValue = record.error

  if (typeof errorValue === 'string') {
    return errorValue
  }

  if (errorValue && typeof errorValue === 'object' && !Array.isArray(errorValue)) {
    const errorRecord = errorValue as Record<string, unknown>
    const message = errorRecord.message
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }

  const message = record.message
  return typeof message === 'string' && message.trim() ? message : null
}

type FormState = {
  prompt: string
  context: string
  negativePrompt: string
  style: string
  model: string
  aspectRatio: string
  durationSeconds: number
  seed: string
}

const samplePrompts = [
  {
    title: 'Brand launch',
    prompt: 'A luxury wristwatch revealed under moving chiaroscuro lighting, macro lens detail, slow camera orbit, premium cinematic pacing.',
  },
  {
    title: 'Product demo',
    prompt: 'A futuristic electric scooter gliding through a rain-slick city street at night, neon reflections, smooth tracking shot, high realism.',
  },
  {
    title: 'Story scene',
    prompt: 'A lone astronaut standing on a cliff above an alien sea, glowing horizon, drifting dust, emotional wide shot with subtle motion.',
  },
]

const styleOptions = ['Cinematic', 'Editorial', 'Documentary', 'Hyperreal', 'Dreamlike', 'Product Launch']

const aspectRatios = ['16:9', '9:16', '1:1', '4:5']

const durationOptions = [5, 8, 12, 16]

const initialForm: FormState = {
  prompt: samplePrompts[0].prompt,
  context: 'High-end motion design, controlled camera movement, polished lighting, and a final hero shot that reads clearly at a glance.',
  negativePrompt: 'blurry frames, warped hands, jitter, low detail, text overlays, watermark, bad anatomy',
  style: 'Cinematic',
  model: 'sora-2-pro',
  aspectRatio: '16:9',
  durationSeconds: 8,
  seed: '',
}

function App() {
  const [config, setConfig] = useState<ConfigState | null>(null)
  const [form, setForm] = useState<FormState>(initialForm)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then((response) => response.json())
      .then((data: ConfigState) => setConfig(data))
      .catch(() => {
        setConfig(null)
      })
  }, [])

  const requestPreview = useMemo(
    () =>
      JSON.stringify(
        {
          prompt: form.prompt,
          context: form.context,
          negativePrompt: form.negativePrompt,
          style: form.style,
          model: form.model,
          aspectRatio: form.aspectRatio,
          durationSeconds: form.durationSeconds,
          seed: form.seed,
        },
        null,
        2,
      ),
    [form],
  )

  async function downloadVideoFile(jobId: string) {
    const statusResponse = await fetch(`/api/videos/${jobId}`)
    const statusData = (await statusResponse.json()) as GenerateResponse

    if (!statusResponse.ok) {
      throw new Error(statusData.error || 'Video status check failed.')
    }

    if (statusData.status === 'failed') {
      throw new Error(extractProviderErrorMessage(statusData) || 'The video generation failed on the provider side.')
    }

    if (statusData.status !== 'completed') {
      return false
    }

    const videoResponse = await fetch(`/api/videos/${jobId}/content`)

    if (!videoResponse.ok) {
      const contentError = (await videoResponse.json().catch(() => ({}))) as GenerateResponse
      throw new Error(contentError.error || 'Video content is not ready yet.')
    }

    const videoBlob = await videoResponse.blob()
    const objectUrl = window.URL.createObjectURL(videoBlob)
    const downloadLink = document.createElement('a')
    downloadLink.href = objectUrl
    downloadLink.download = `sora-2-${jobId}.mp4`
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    window.URL.revokeObjectURL(objectUrl)
    return true
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: form.prompt,
          context: form.context,
          negativePrompt: form.negativePrompt,
          style: form.style,
          model: form.model,
          aspectRatio: form.aspectRatio,
          durationSeconds: form.durationSeconds,
          seed: form.seed,
        }),
      })

      const data = (await response.json()) as GenerateResponse

      if (!response.ok) {
        throw new Error(data.error || 'Video generation request failed.')
      }

      setResult(data)

      if (data.jobId && !data.videoUrl) {
        const startedAt = Date.now()
        const timeoutMs = 15 * 60 * 1000

        while (Date.now() - startedAt < timeoutMs) {
          const downloaded = await downloadVideoFile(data.jobId)
          if (downloaded) {
            return
          }

          await new Promise((resolve) => window.setTimeout(resolve, 5000))
        }

        throw new Error('Timed out while waiting for the video to finish rendering.')
      }

      if (data.videoUrl) {
        const directDownload = document.createElement('a')
        directDownload.href = data.videoUrl
        directDownload.download = `sora-2-${data.jobId || 'video'}.mp4`
        document.body.appendChild(directDownload)
        directDownload.click()
        directDownload.remove()
      }
    } catch (requestError) {
      setResult(null)
      setError(requestError instanceof Error ? requestError.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(requestPreview)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Clipboard access was blocked. Copy the request preview manually.')
    }
  }

  const rawResponse =
    typeof result?.rawResponse === 'string'
      ? result.rawResponse
      : result?.rawResponse
        ? JSON.stringify(result.rawResponse, null, 2)
        : ''
  const providerReady = Boolean(config?.videoApiUrlConfigured && config?.videoApiKeyConfigured)

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Sora 2 Video Generator</div>
        <h1>Local video prompts, server-side API keys, immediate preview.</h1>
        <p className="lede">
          This app stays local, sends the request through your own Express proxy, and keeps your video API key out of the browser.
        </p>

        <div className="status-row">
          <span className={`pill ${providerReady ? 'pill-good' : 'pill-warn'}`}>
            {providerReady ? 'API configured' : 'Configure .env.local'}
          </span>
          <span className="pill pill-soft">{config?.providerLabel || 'Custom video API'}</span>
          <span className="pill pill-soft">{config?.videoApiModel || form.model}</span>
        </div>
      </section>

      <section className="grid">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <div className="panel-header">
            <div>
              <h2>Generate</h2>
              <p>Shape the exact shot and send it to your connected video endpoint.</p>
            </div>
            <button type="button" className="ghost-button" onClick={copyRequest}>
              {copied ? 'Copied' : 'Copy request'}
            </button>
          </div>

          <label className="field">
            <span>Prompt</span>
            <textarea
              value={form.prompt}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
              rows={6}
              placeholder="Describe the shot, subject, motion, lighting, and mood"
            />
          </label>

          <label className="field">
            <span>Context</span>
            <textarea
              value={form.context}
              onChange={(event) => setForm((current) => ({ ...current, context: event.target.value }))}
              rows={4}
              placeholder="Extra production notes, brand tone, camera language, or scene constraints"
            />
          </label>

          <label className="field">
            <span>Negative prompt</span>
            <textarea
              value={form.negativePrompt}
              onChange={(event) => setForm((current) => ({ ...current, negativePrompt: event.target.value }))}
              rows={3}
              placeholder="What should the model avoid?"
            />
          </label>

          <div className="row">
            <label className="field">
              <span>Style</span>
              <select
                value={form.style}
                onChange={(event) => setForm((current) => ({ ...current, style: event.target.value }))}
              >
                {styleOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Model</span>
              <input
                value={form.model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                placeholder="sora-2"
              />
            </label>
          </div>

          <div className="row">
            <label className="field">
              <span>Aspect ratio</span>
              <select
                value={form.aspectRatio}
                onChange={(event) => setForm((current) => ({ ...current, aspectRatio: event.target.value }))}
              >
                {aspectRatios.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Duration</span>
              <select
                value={form.durationSeconds}
                onChange={(event) => setForm((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}
              >
                {durationOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} seconds
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Seed</span>
            <input
              value={form.seed}
              onChange={(event) => setForm((current) => ({ ...current, seed: event.target.value }))}
              placeholder="Optional reproducibility seed"
            />
          </label>

          <div className="chip-row">
            {samplePrompts.map((sample) => (
              <button
                type="button"
                key={sample.title}
                className="chip"
                onClick={() => setForm((current) => ({ ...current, prompt: sample.prompt }))}
              >
                {sample.title}
              </button>
            ))}
          </div>

          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? 'Sending request...' : 'Generate video'}
          </button>
        </form>

        <aside className="panel output-panel">
          <div className="panel-header">
            <div>
              <h2>Output</h2>
              <p>See the normalized response, the raw provider payload, and any video URL the API returns.</p>
            </div>
          </div>

          <div className="summary-grid">
            <div className="summary-card">
              <span>Status</span>
              <strong>{error ? 'Error' : loading ? 'Generating' : result ? 'Ready' : 'Idle'}</strong>
            </div>
            <div className="summary-card">
              <span>Model</span>
              <strong>{form.model}</strong>
            </div>
            <div className="summary-card">
              <span>Duration</span>
              <strong>{form.durationSeconds}s</strong>
            </div>
            <div className="summary-card">
              <span>Aspect</span>
              <strong>{form.aspectRatio}</strong>
            </div>
          </div>

          {error ? <div className="message message-error">{error}</div> : null}

          {result?.jobId ? (
            <div className="empty-state">
              <strong>Downloading in progress.</strong>
              <p>The finished video will be saved to your downloads automatically once rendering completes.</p>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No video yet.</strong>
              <p>
                Generate a video and the finished file will download automatically.
              </p>
            </div>
          )}

          <section className="code-block">
            <div className="code-title">Request preview</div>
            <pre>{requestPreview}</pre>
          </section>

          <section className="code-block">
            <div className="code-title">Provider response</div>
            <pre>{rawResponse || 'Waiting for a generation response.'}</pre>
          </section>

          {result ? (
            <div className="meta-row">
              <span>Provider status: {result.providerStatus ?? 'unknown'}</span>
              <span>Job ID: {result.jobId || 'n/a'}</span>
              <span>Transport: {result.contentType || 'unknown'}</span>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  )
}

export default App
