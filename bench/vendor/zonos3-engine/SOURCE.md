# ZONOS3-Mini in-browser engine (vendored build)

- Source: https://github.com/Zyphra/ZONOS3-Mini (`servers/web`), MIT License (see LICENSE, NOTICE)
- Commit: a50e14117d99181ba7f28047b451ba03ba1a09a9 (2026-11-17)
- Built with: `pnpm install --filter zonos3-web`, `pnpm gen:api`, `npx vite build` (in `servers/web`)
- Files: engine.js (main-thread facade), worker.js (WebGPU engine worker), codec-worker.js
- Weights are NOT bundled. They are downloaded once from the public Hugging Face repo
  `Zyphra/ZONOS3-Mini` (folder `web/`, Apache-2.0) at a pinned revision and kept in Cache Storage.
- Audit at vendoring time: no external URLs, no sendBeacon/WebSocket/XMLHttpRequest in the built files.

## Local patch (face-interpreter)

`patches/0001-stage-reports-and-light-startup.patch`, applied on top of the commit above before building:

- `engine.onStage(cb)`: the worker reports each start-up step ('gpu', 'weights', 'companions', codec, warm-up steps,
  '준비 완료'), so a GPU device loss during start-up can be located.
- Optional flags in the models URL query (relative model paths resolve without them):
  `zacq8=1` keeps the q8 codec kernels instead of timing f16 ("h8") variants at load;
  `warm=min` warms only the short prompt and plain sampling (skips the 309-row reference prompt and CFG pair);
  `warm=off` skips the warm-up.
- Reason: on a Galaxy S22 Ultra (Adreno 7xx, Chrome 158) start-up lost the GPU device (VK_ERROR_DEVICE_LOST)
  right after all weights were loaded, repeatedly.

To rebuild: apply the patch in `servers/web`, then `pnpm gen:api && npx vite build`, copy `dist/*.js` here.
