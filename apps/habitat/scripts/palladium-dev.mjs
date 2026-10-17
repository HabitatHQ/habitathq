#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const localToolchain = resolve(root, 'scratch/habitat-toolchain')
const localCargo = resolve(localToolchain, 'cargo/bin/cargo')
const hasLocalCargo = existsSync(localCargo)
const cargo = hasLocalCargo ? localCargo : 'cargo'
const env = hasLocalCargo
  ? { ...process.env, CARGO_HOME: resolve(localToolchain, 'cargo'), RUSTUP_HOME: resolve(localToolchain, 'rustup') }
  : process.env
mkdirSync(resolve(root, 'scratch/habitat-palladium'), { recursive: true })
const child = spawn(cargo, [
  'run', '--locked', '-p', 'palladium-cli', '--', '--db',
  'sqlite:scratch/habitat-palladium/changes.db', 'dev', '--host', '127.0.0.1',
  '--port', '4000', '--auth', 'static',
], { cwd: root, env, stdio: 'inherit' })
child.on('error', error => { process.stderr.write(`Could not start Palladium: ${error.message}. Install Rust and retry.\n`); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
