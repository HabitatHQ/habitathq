#!/usr/bin/env node
// Fetch large binary assets that ship with the app for offline use but are too
// big to commit to git. Idempotent — exits early if files already present.
//
// Run automatically before native builds via `prebuild:native` (PWA stays opt-in
// to keep casual-visitor download lean — run `pnpm fetch:assets` manually if
// you want full PWA offline coverage).
//
// Fetches:
//   - Tesseract OCR English language data (~10 MB) for offline receipt scanning
//   - HuggingFace Xenova/all-MiniLM-L6-v2 sentence embeddings (~25 MB)
//   - onnxruntime-web .wasm files (copied from node_modules) for the model

import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(__dirname, '..', 'public')
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

const HF_BASE = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main'

const REMOTE_ASSETS = [
  {
    name: 'Tesseract English language data',
    url: 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz',
    out: `${PUBLIC}/tessdata/eng.traineddata.gz`,
    minBytes: 5_000_000,
  },
  {
    name: 'all-MiniLM-L6-v2 config.json',
    url: `${HF_BASE}/config.json`,
    out: `${PUBLIC}/models/Xenova/all-MiniLM-L6-v2/config.json`,
    minBytes: 100,
  },
  {
    name: 'all-MiniLM-L6-v2 tokenizer.json',
    url: `${HF_BASE}/tokenizer.json`,
    out: `${PUBLIC}/models/Xenova/all-MiniLM-L6-v2/tokenizer.json`,
    minBytes: 10_000,
  },
  {
    name: 'all-MiniLM-L6-v2 tokenizer_config.json',
    url: `${HF_BASE}/tokenizer_config.json`,
    out: `${PUBLIC}/models/Xenova/all-MiniLM-L6-v2/tokenizer_config.json`,
    minBytes: 50,
  },
  {
    name: 'all-MiniLM-L6-v2 model_quantized.onnx',
    url: `${HF_BASE}/onnx/model_quantized.onnx`,
    out: `${PUBLIC}/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx`,
    minBytes: 10_000_000,
  },
]

// Files copied directly out of node_modules — no fetch needed.
// We ship only the simd-threaded variant (~13MB). The JSEP (WebGPU) variant
// adds ~26MB for marginal speedup on the embedding model and isn't supported
// in Capacitor's WebView.
const ORT_WASM_NAMES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

async function fetchAsset({ name, url, out, minBytes }) {
  if (existsSync(out)) {
    const size = statSync(out).size
    if (size >= minBytes) {
      console.log(`  ✓ ${name} present (${(size / 1_000_000).toFixed(1)} MB)`)
      return
    }
    console.log(`  ↻ ${name} appears truncated (${size}B), refetching`)
  }
  mkdirSync(dirname(out), { recursive: true })
  console.log(`  ↓ ${name}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`)
  if (!res.body) throw new Error(`${name}: empty body`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out))
  const size = statSync(out).size
  console.log(`  ✓ ${name} → ${out} (${(size / 1_000_000).toFixed(1)} MB)`)
}

function findOnnxRuntimeWebDist() {
  // onnxruntime-web is a transitive dep of @huggingface/transformers; pnpm
  // hoists it under a hashed dir in the workspace root's node_modules/.pnpm.
  const pnpmDir = `${REPO_ROOT}/node_modules/.pnpm`
  if (!existsSync(pnpmDir)) return null
  const match = readdirSync(pnpmDir).find((name) => name.startsWith('onnxruntime-web@'))
  if (!match) return null
  const distDir = `${pnpmDir}/${match}/node_modules/onnxruntime-web/dist`
  return existsSync(distDir) ? distDir : null
}

function copyOrtWasm() {
  const distDir = findOnnxRuntimeWebDist()
  if (!distDir) {
    console.log('  ⚠ onnxruntime-web not found in node_modules; skipping wasm copy')
    return
  }
  const outDir = `${PUBLIC}/onnx-wasm`
  mkdirSync(outDir, { recursive: true })
  for (const name of ORT_WASM_NAMES) {
    const src = `${distDir}/${name}`
    const dst = `${outDir}/${name}`
    if (!existsSync(src)) {
      console.log(`  ⚠ ${name} missing in onnxruntime-web (skipping)`)
      continue
    }
    copyFileSync(src, dst)
    const size = statSync(dst).size
    console.log(`  ✓ ${name} (${(size / 1_000_000).toFixed(2)} MB)`)
  }
}

console.log('Fetching offline assets…')
for (const a of REMOTE_ASSETS) {
  await fetchAsset(a)
}
console.log('Copying onnxruntime-web WASM…')
copyOrtWasm()
console.log('Done.')
