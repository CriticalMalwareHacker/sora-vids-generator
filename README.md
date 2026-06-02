# Sora 2 Video Generator

A local React + Express app for crafting video prompts and sending them to your own video-generation API without exposing API keys to the browser.

> Warning: the Sora model is deprecated on September 24, 2026.

## Features

- Single-page React UI for prompt, context, negative prompt, and style inputs
- Express proxy that forwards requests to your configured video provider
- API key stored in `.env.local` and never shipped to the client
- Normalized response handling (video URL, job ID, raw provider payload)
- Optional download flow for OpenAI-style `/v1/videos` job responses

## Requirements

- Node.js 18+ (for built-in `fetch`)
- npm

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env.local` file in the project root:

   ```bash
   cp .env.example .env.local
   ```

3. Update `.env.local` with your provider details:

   ```bash
   VIDEO_API_URL=https://api.openai.com/v1/videos
   VIDEO_API_KEY=your-secret-key
   VIDEO_API_KEY_HEADER=Authorization
   VIDEO_API_KEY_PREFIX=Bearer
   VIDEO_MODEL=sora-2
   VIDEO_PROVIDER=OpenAI Sora 2
   PORT=3000
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Usage

- Fill out the form and click **Generate video**.
- The request preview and provider response appear on the right.
- If the provider returns a direct `videoUrl`, the app downloads it immediately.
- If the provider returns a job ID (OpenAI-style), the app polls `/api/videos/:id` and downloads `/api/videos/:id/content` once ready.

## Provider behavior

- When `VIDEO_API_URL` points to `https://api.openai.com/v1/videos`, the server maps inputs to OpenAI’s expected payload (`model`, `prompt`, `size`, `seconds`).
- For other providers, the server forwards the full form payload (`prompt`, `context`, `negativePrompt`, `style`, `aspectRatio`, `durationSeconds`, `seed`) and adds metadata.
- If your provider does not return a direct video URL, update `server.ts` to match its job status and download endpoints.

## Scripts

- `npm run dev` — start the Vite + Express dev server
- `npm run build` — build client and bundle the server
- `npm run start` — run the production server from `dist/`
- `npm run preview` — build and run the production server
- `npm run lint` — run ESLint
- `npm run clean` — remove build output

## Security note

This app keeps API keys on the server only. Never commit `.env.local`.
