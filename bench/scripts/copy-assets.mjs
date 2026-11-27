// Copies runtime assets that must be served from our own origin (no CDN at runtime):
// - onnxruntime-web WASM binaries (transformers.js would otherwise pull them from jsDelivr)
// - the vendored ZONOS3-Mini browser engine
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortOut = join(root, 'public', 'ort');
mkdirSync(ortOut, { recursive: true });
for (const f of readdirSync(ortDist)) {
  if (/^ort-wasm-simd-threaded(\.asyncify)?\.(mjs|wasm)$/.test(f)) cpSync(join(ortDist, f), join(ortOut, f));
}
cpSync(join(root, 'vendor', 'zonos3-engine'), join(root, 'public', 'zonos3-engine'), { recursive: true });
console.log('assets copied: public/ort, public/zonos3-engine');
