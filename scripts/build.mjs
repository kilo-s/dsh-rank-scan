#!/usr/bin/env node
/**
 * 跨平台构建：src/ → lib/，并把面板 bundle 复制进 lib/。
 *
 * 为什么不用 bash：Windows 上没有可用的 bash（system32\bash.exe 是 WSL 存根），
 * 而 git 直装（dsh plugin add github:…）依赖 package.json 的 prepare 在**用户机器上**跑构建，
 * 所以构建入口必须是纯 Node。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = process.env.USERPROFILE || process.env.HOME || ''
const candidates = [
  // 1) 本包自己的依赖（npm install / git 直装都会装到这里）
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  join(root, 'node_modules', 'typescript', 'lib', 'tsc.js'),
  // 2) 同级的 node_modules（monorepo / 工作区布局）
  join(root, '..', 'node_modules', 'typescript', 'bin', 'tsc'),
  // 3) 开发机上的 DSH checkout（一些环境禁止 symlink，依赖装不进来时用它兜底）
  process.env.DSH_CHECKOUT ? join(process.env.DSH_CHECKOUT, 'node_modules', 'typescript', 'bin', 'tsc') : '',
  home ? join(home, 'dsh-harness', 'node_modules', 'typescript', 'bin', 'tsc') : '',
  home ? join(home, 'dsh', 'node_modules', 'typescript', 'bin', 'tsc') : '',
].filter(Boolean)

const tsc = candidates.find((p) => existsSync(p))
if (!tsc) {
  console.error('build: 找不到 typescript。请先 npm install（git 直装时由 package manager 自动装 devDependencies）。')
  process.exit(1)
}

execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' })

const partsDir = join(root, 'client', 'parts')
const parts = existsSync(partsDir)
  ? readdirSync(partsDir).filter((f) => f.endsWith('.js')).sort()
  : []
if (parts.length === 0) {
  console.error('build: 缺 client/parts/*.js（面板源）')
  process.exit(1)
}
let bundle = ''
for (const f of parts) bundle += readFileSync(join(partsDir, f), 'utf8')
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), bundle)
console.log('build: 完成 → lib/（host 由 tsc 产出；面板 bundle 由 client/parts/*.js 按名拼接）')
