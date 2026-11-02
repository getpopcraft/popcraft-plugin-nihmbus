import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConnector, fakeApi } from './harness.mjs'

const createConnector = loadConnector()
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

/** A fake Nihmbus relay: answers pair/me/poll/result/upload, records what the plugin sent. */
function fakeRelay({ commands = [], pollStatus = 200, onIdle = () => {} } = {}) {
  const log = []
  const results = []
  const queue = [...commands]
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    const headers = init.headers || {}
    log.push({ path, method: init.method || 'GET', headers, body: init.body ? JSON.parse(init.body) : undefined })
    assert.equal(headers['X-Nihmbus-Device-Protocol'], '1')
    assert.equal(headers['X-Nihmbus-Extension-Protocol'], '1')
    if (path.endsWith('/pair')) {
      return JSON.parse(init.body).code === 'GOOD-CODE'
        ? json(200, {
            token: 'nxd_secret',
            device: { name: 'PopCraft' },
            workspaceName: 'Acme',
            serverUrl: 'https://nihmbus.test',
          })
        : json(401, { error: 'That code is invalid or expired.' })
    }
    assert.equal(headers.Authorization, 'Bearer nxd_secret')
    if (path.endsWith('/me')) return json(200, { device: { name: 'PopCraft' }, workspaceName: 'Acme' })
    if (path.endsWith('/poll')) {
      if (pollStatus !== 200) return json(pollStatus, { error: 'nope' })
      const command = queue.shift() ?? null
      if (!command) onIdle()
      return json(200, { command })
    }
    if (path.endsWith('/result')) {
      results.push(JSON.parse(init.body))
      return json(200, { accepted: true })
    }
    if (path.endsWith('/upload')) {
      const b = JSON.parse(init.body)
      return json(200, {
        url: `https://blob.test/put/${b.filename}`,
        method: 'PUT',
        headers: { 'Content-Type': b.contentType },
        pathname: `ws/w/ext-devices/popcraft/${b.commandId}/${b.filename}`,
      })
    }
    return json(404, {})
  }
  return { fetch, log, results }
}

async function connected(relayOpts) {
  const f = fakeApi()
  let c
  const relay = fakeRelay({ ...relayOpts, onIdle: () => c.stop() })
  c = createConnector({ api: f.api, fetch: relay.fetch, sleep: async () => c.stop() })
  await c.pair({ code: 'GOOD-CODE', server: 'https://nihmbus.test' })
  return { c, f, relay }
}

test('pairs, stores the token in plugin storage, and never sends it anywhere but the server', async () => {
  const { c, f, relay } = await connected()
  assert.equal(f.store.get('connection').token, 'nxd_secret')
  assert.equal(c.connection.workspaceName, 'Acme')
  const pairCall = relay.log.find((l) => l.path.endsWith('/pair'))
  assert.equal(pairCall.body.client.app, 'popcraft')
  assert.match(pairCall.body.deviceId, /^pc-[a-z0-9]{24}$/)
  assert.equal(f.store.get('deviceId'), pairCall.body.deviceId)
})

test('a bad code reports the server error and stays disconnected', async () => {
  const f = fakeApi()
  const relay = fakeRelay()
  const c = createConnector({ api: f.api, fetch: relay.fetch })
  await c.onMessage({ type: 'pair', code: 'BAD', server: 'https://nihmbus.test' })
  assert.equal(c.state.status, 'disconnected')
  assert.match(c.state.detail, /invalid or expired/)
  assert.equal(f.store.get('connection'), undefined)
})

test('refuses non-https servers', async () => {
  const f = fakeApi()
  const c = createConnector({ api: f.api, fetch: fakeRelay().fetch })
  await assert.rejects(() => c.pair({ code: 'GOOD-CODE', server: 'http://evil.example' }), /https/)
  await c.pair({ code: 'GOOD-CODE', server: 'http://localhost:3000' }) // local development is allowed
})

test('runs status, call (batched) and export, and reports each result', async () => {
  const commands = [
    { id: 'c1', tool: 'status', args: {} },
    {
      id: 'c2',
      tool: 'call',
      args: {
        calls: [
          { method: 'createNode', args: ['TEXT', { name: 'Title' }] },
          { method: 'setText', args: ['n-1', 'Hello'] },
        ],
      },
    },
    { id: 'c3', tool: 'export', args: { nodeId: 'f1', format: 'PNG', scale: 2 } },
    { id: 'c4', tool: 'export', args: { nodeId: 'f1', format: 'SVG', filename: 'logo' } },
  ]
  const { c, f, relay } = await connected({ commands })
  await c.loop()
  const byId = Object.fromEntries(relay.results.map((r) => [r.id, r]))
  assert.equal(byId.c1.ok, true)
  assert.equal(byId.c1.result.page.id, 'page-1')
  assert.deepEqual(byId.c1.result.selection, [{ id: 'f1', name: 'Poster', type: 'FRAME' }])
  assert.deepEqual(byId.c2.result, { results: ['n-1', null] })
  assert.deepEqual(f.calls.slice(0, 2), [
    ['createNode', 'TEXT', { name: 'Title' }],
    ['setText', 'n-1', 'Hello'],
  ])
  assert.deepEqual(byId.c3.result, { exported: { nodeId: 'f1', format: 'PNG', bytes: 4 } })
  assert.deepEqual(byId.c3.files, [
    {
      pathname: 'ws/w/ext-devices/popcraft/c3/Poster - Final.png',
      name: 'Poster - Final.png',
      contentType: 'image/png',
    },
  ])
  assert.deepEqual(f.calls[2], ['upload', 'https://blob.test/put/Poster - Final.png', 'PUT', 'image/png', 4])
  assert.equal(byId.c4.files[0].name, 'logo.svg')
  assert.equal(byId.c4.files[0].contentType, 'image/svg+xml')
})

test('refuses methods outside the allowlist, bad args and unknown tools', async () => {
  const commands = [
    { id: 'a', tool: 'call', args: { method: 'storageSet', args: [] } },
    { id: 'b', tool: 'call', args: { method: 'createNode', args: 'TEXT' } },
    {
      id: 'c',
      tool: 'call',
      args: {
        calls: [
          { method: 'createNode', args: ['RECTANGLE'] },
          { method: 'setKeyframes', args: [{}] },
        ],
      },
    },
    { id: 'd', tool: 'rm_rf', args: {} },
    { id: 'e', tool: 'export', args: { nodeId: 'missing' } },
  ]
  const { c, f, relay } = await connected({ commands })
  await c.loop()
  const byId = Object.fromEntries(relay.results.map((r) => [r.id, r]))
  assert.match(byId.a.error, /not an allowed PopCraft plugin method/)
  assert.ok(!f.calls.some((x) => x[0] === 'storageSet'))
  assert.match(byId.b.error, /args must be an array/)
  assert.equal(byId.c.error, 'call 1 (setKeyframes): bad keyframes')
  assert.match(byId.d.error, /doesn't know the tool "rm_rf"/)
  assert.match(byId.e.error, /No layer with id missing/)
  for (const r of Object.values(byId)) assert.equal(r.ok, false)
})

test('a revoked token forgets the connection and stops polling', async () => {
  const { c, f } = await connected({ pollStatus: 401 })
  await c.loop()
  assert.equal(c.state.status, 'disconnected')
  assert.equal(f.store.get('connection'), null)
  assert.equal(c.connection, null)
})

test('an outdated plugin stops and says so', async () => {
  const { c } = await connected({ pollStatus: 426 })
  await c.loop()
  assert.equal(c.state.status, 'outdated')
})

test('reconnects from storage on start, and checks the token first', async () => {
  const f = fakeApi()
  f.store.set('connection', {
    server: 'https://nihmbus.test',
    token: 'nxd_secret',
    deviceName: 'PopCraft',
    workspaceName: null,
  })
  let c
  const relay = fakeRelay({ onIdle: () => c.stop() })
  c = createConnector({ api: f.api, fetch: relay.fetch, sleep: async () => c.stop() })
  await c.start()
  await new Promise((r) => setTimeout(r, 20)) // let the first poll run
  assert.equal(relay.log[0].path, '/api/ext/popcraft/device/me')
  assert.equal(c.connection.workspaceName, 'Acme')
})
