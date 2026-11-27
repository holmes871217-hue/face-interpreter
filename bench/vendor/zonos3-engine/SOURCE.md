# ZONOS3-Mini in-browser engine (vendored build)

- Source: https://github.com/Zyphra/ZONOS3-Mini (`servers/web`), MIT License (see LICENSE, NOTICE)
- Commit: a50e14117d99181ba7f28047b451ba03ba1a09a9 (2026-11-17)
- Built with: `pnpm install --filter zonos3-web`, `pnpm gen:api`, `npx vite build` (in `servers/web`)
- Files: engine.js (main-thread facade), worker.js (WebGPU engine worker), codec-worker.js
- Weights are NOT bundled. They are downloaded once from the public Hugging Face repo
  `Zyphra/ZONOS3-Mini` (folder `web/`, Apache-2.0) at a pinned revision and kept in Cache Storage.
- Audit at vendoring time: no external URLs, no sendBeacon/WebSocket/XMLHttpRequest in the built files.
