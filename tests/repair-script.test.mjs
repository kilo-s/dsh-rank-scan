import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('真实救援脚本：合法缩进零改动、坏嵌套备份修复、DryRun、Restore', {skip:process.platform !== 'win32'}, () => {
 const root=mkdtempSync(resolve('.tmp-repair-'))
 const profile=join(root,'.dsh/profiles/probe'); mkdirSync(profile,{recursive:true})
 const patch=join(profile,'cordis.patch.yml')
 const run=(args=[])=>{const fd=openSync(join(root,'output.txt'),'w');try{return spawnSync('pwsh',['-NoProfile','-File',resolve('scripts/repair-patch.ps1'),'-Profile','probe',...args],{env:{...process.env,USERPROFILE:root},stdio:['ignore',fd,fd]}).status}finally{closeSync(fd)}}
 try {
  const valid='  - id: keep\n    disabled: true\n';writeFileSync(patch,valid);assert.equal(run(),0);assert.equal(readFileSync(patch,'utf8'),valid);assert.equal(readdirSync(profile).length,1)
  const bad='- id: keep\n  config:\n    panel: true\n   bad: 1\n';writeFileSync(patch,bad);assert.equal(run(['-DryRun']),0);assert.equal(readFileSync(patch,'utf8'),bad);assert.equal(readdirSync(profile).length,1)
  assert.equal(run(),0);assert.equal(readFileSync(patch,'utf8').trim(),'[]');assert.equal(run(['-Restore']),0);assert.equal(readFileSync(patch,'utf8'),bad)
 } finally {rmSync(root,{recursive:true,force:true})}
})
