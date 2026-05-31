# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

````js
export default defineConfig([
  # Sora 2 Video Generator

  A locally hosted React app with a server-side proxy for your video generation API.

  The browser talks only to the local Express server. Your API key stays in `.env.local` and is forwarded from the server to whatever video endpoint you configure.

  ## Setup

  1. Install dependencies:

     ```bash
     npm install
     ```

  2. Create a `.env.local` file in the project root with your provider details:

     ```bash
   VIDEO_API_URL=https://api.openai.com/v1/videos
     VIDEO_API_KEY=your-secret-key
     VIDEO_API_KEY_HEADER=Authorization
     VIDEO_API_KEY_PREFIX=Bearer
     VIDEO_MODEL=sora-2
   VIDEO_PROVIDER=OpenAI Sora 2
     PORT=3000
     ```

  3. Start the local app:

     ```bash
     npm run dev
     ```

  Open `http://localhost:3000`.

  ## What the app sends

  The frontend collects:

  - prompt
  - extra context
  - negative prompt
  - style
  - model
  - aspect ratio
  - duration
  - optional seed

   For OpenAI video requests, the server maps the form to `POST /v1/videos` and normalizes common response shapes such as:

  - `videoUrl`
  - `url`
  - `output[0].url`
  - `data.videoUrl`
  - `jobId` / `id` / `requestId`

  If your provider returns a job instead of a direct video URL, the raw response is still shown in the UI.

  ## Build and run

  ```bash
  npm run build
  npm run start
````

## Notes

- The project is intentionally provider-agnostic because different video APIs use different request and response formats.
- If your API expects a different payload shape, adjust the body in [`server.ts`](server.ts) and keep the frontend the same.
