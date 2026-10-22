// 用 Edge 调试接口按真实时间打开页面、等若干毫秒后截图（无界面 + 虚拟时间时 requestAnimationFrame 不跑）
// 用法：node cdpshot.mjs <url> <输出.png> <等多少毫秒> [metrics]
// 加 metrics：打印第 900ms 到截图前这段时间主线程的开销（配合 &sweep=1 量快速来回扫的性能）
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, out, waitMs, metrics] = process.argv.slice(2)
const port = 9333 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), 'edge-'))
spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--window-size=1080,720',
  'about:blank',
])
const sleep = (t) => new Promise((r) => setTimeout(r, t))
// Edge 会再开一堆子进程，主进程先退出后它们就脱离了进程树；按这次专用的临时目录名找出来全部结束，中途出错、超时也一样
const quit = (code) => {
  const kill = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  spawn('powershell', ['-NoProfile', '-Command', kill], { stdio: 'ignore' }).on('exit', () => process.exit(code))
}
setTimeout(() => quit(1), Number(waitMs) + 20000)
process.on('uncaughtException', (e) => {
  console.error(e)
  quit(1)
})
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    target = list.find((t) => t.type === 'page')
  } catch {
    // Edge 还没启动好，过一会儿再试
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (pending.has(d.id)) pending.get(d.id)(d.result)
}
const send = (method, params = {}) =>
  new Promise((r) => {
    pending.set(++id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
await send('Page.enable')
await send('Performance.enable')
await send('Page.navigate', { url })
const read = async () =>
  Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
await sleep(900)
const before = await read()
await sleep(Number(waitMs) - 900)
if (metrics) {
  const after = await read()
  for (const k of [
    'RecalcStyleCount',
    'RecalcStyleDuration',
    'LayoutCount',
    'LayoutDuration',
    'ScriptDuration',
    'TaskDuration',
    'JSHeapUsedSize',
  ])
    console.log(k, (after[k] - (k === 'JSHeapUsedSize' ? 0 : before[k])).toFixed(k.endsWith('Duration') ? 3 : 0))
}
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
ws.close()
quit(0)
