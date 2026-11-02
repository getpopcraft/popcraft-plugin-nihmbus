/// <reference types="@popcraft/plugins" />
// Nihmbus for PopCraft — connects this PopCraft editor to Nihmbus as a "device", so Nihmbus agents can design in it.
//
// Every connection is outgoing from here: the plugin long-polls Nihmbus for commands, runs them with the plugin API,
// and posts the results. Nothing listens on this machine. Protocol: docs/protocol.md; tool contract: docs/tools.md.

const PLUGIN = { id: 'popcraft.nihmbus', version: '0.1.0' }
const RELAY_PROTOCOL = 1 // the Nihmbus device relay (core)
const EXTENSION_PROTOCOL = 1 // the PopCraft extension's tool contract
const EXTENSION = 'popcraft'
const DEFAULT_SERVER = 'https://nihmbus.ai'
const STORAGE_KEY = 'connection'
const DEVICE_ID_KEY = 'deviceId'
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
const MAX_RESULT_CHARS = 900 * 1024 // the relay accepts 1 MB; keep headroom for the envelope
const MAX_CALLS = 50

/** Plugin API methods an agent may run through the `call` tool (kept in sync with the extension's manifest enum). */
const ALLOWED_METHODS = new Set([
  'getSelection', 'getNode', 'findNodes', 'getCurrentPage', 'getDocumentOutline', 'measureNodes', 'getStyles',
  'getVariables', 'getAnimation', 'getCompositions', 'getSequence', 'getStateMachine', 'getRecords',
  'getPresentationAudio', 'getPresentationMix', 'createNode', 'createPage', 'createImage', 'createComponent',
  'createInstance', 'createPaintStyle', 'createComposition', 'createMotionComponent', 'updateNode', 'deleteNode',
  'duplicateNodes', 'renameNodes', 'moveNodes', 'resizeNodes', 'rotateNodes', 'flipNodes', 'reorderNodes',
  'reparentNodes', 'groupNodes', 'ungroupNodes', 'alignNodes', 'distributeNodes', 'booleanOperation', 'flattenNodes',
  'outlineStroke', 'shapeBuilder', 'importSvg', 'setSelection', 'setCurrentPage', 'renamePage', 'setPageSetup',
  'setLocked', 'setVisible', 'setMask', 'setMaskType', 'setAutoLayout', 'setFills', 'setStrokes', 'setEffects',
  'setShaderFill', 'replaceColor', 'applyStyle', 'setVariableValue', 'setText', 'setTypography', 'setTextFit',
  'setTextPath', 'flowTextIntoShape', 'detachText', 'editTextAnimation', 'setTimeline', 'setKeyframes',
  'editBehaviours', 'applyMotionPreset', 'staggerMotion', 'setLayerTiming', 'setInstancePlayback', 'editComposition',
  'editSequence', 'editVideoClip', 'editFrameAudio', 'detectAudioOnsets', 'cutToBeat', 'edit3DScene',
  'editStateMachine', 'editPrototype', 'editComponentProperty', 'editCollection', 'editRecords', 'setRecord',
  'bindField', 'setRepeat', 'setRoute', 'setSemantics', 'setControl', 'setShowAdvance', 'setPresentationTiming',
  'setPresentationAudioSettings', 'removePresentationAudioClip', 'usePresentationFallbackAudio'])

const EXPORT_TYPES = { PNG: 'image/png', JPG: 'image/jpeg', WEBP: 'image/webp', SVG: 'image/svg+xml', PDF: 'application/pdf' }
const EXPORT_EXT = { PNG: 'png', JPG: 'jpg', WEBP: 'webp', SVG: 'svg', PDF: 'pdf' }

/**
 * The connector. `deps` are injected so tests can run it without PopCraft: `api` is the `popcraft` global,
 * `fetch` the network, `sleep(ms)` a timer, `random()` for the device id.
 */
function createConnector(deps) {
  const { api, fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = () => Math.random() } = deps
  let conn = null // { server, token, deviceName, workspaceName }
  let running = false
  let stopRequested = false
  let state = { status: 'idle', detail: '' }

  const ui = (msg) => { try { api.ui.postMessage(msg) } catch { /* no panel */ } }
  const setState = (status, detail = '') => {
    state = { status, detail }
    ui({ type: 'state', status, detail, conn: conn && { server: conn.server, deviceName: conn.deviceName, workspaceName: conn.workspaceName } })
  }
  const headers = (extra = {}) => ({
    'X-Nihmbus-Device-Protocol': String(RELAY_PROTOCOL),
    'X-Nihmbus-Extension-Protocol': String(EXTENSION_PROTOCOL),
    ...(conn ? { Authorization: `Bearer ${conn.token}` } : {}),
    ...extra,
  })
  const url = (server, path) => `${server.replace(/\/+$/, '')}/api/ext/${EXTENSION}/device/${path}`

  async function deviceId() {
    let id = await api.storage.get(DEVICE_ID_KEY)
    if (typeof id !== 'string' || !id) {
      id = 'pc-' + Array.from({ length: 24 }, () => Math.floor(random() * 36).toString(36)).join('')
      await api.storage.set(DEVICE_ID_KEY, id)
    }
    return id
  }

  function normaliseServer(raw) {
    const s = String(raw || DEFAULT_SERVER).trim().replace(/\/+$/, '')
    const u = new URL(s)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('The server must be an https:// address.')
    return u.origin
  }

  async function pair({ code, server, name }) {
    const base = normaliseServer(server)
    setState('pairing')
    const res = await fetch(url(base, 'pair'), {
      method: 'POST',
      headers: { 'X-Nihmbus-Device-Protocol': String(RELAY_PROTOCOL), 'X-Nihmbus-Extension-Protocol': String(EXTENSION_PROTOCOL), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: String(code || ''),
        deviceId: await deviceId(),
        name: name || 'PopCraft',
        client: { app: 'popcraft', version: PLUGIN.version },
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `Nihmbus answered ${res.status}.`)
    conn = { server: normaliseServer(body.serverUrl || base), token: body.token, deviceName: body.device?.name ?? 'PopCraft', workspaceName: body.workspaceName ?? null }
    await api.storage.set(STORAGE_KEY, conn)
    return conn
  }

  async function forget(reason) {
    conn = null
    await api.storage.set(STORAGE_KEY, null)
    setState('disconnected', reason || '')
  }

  /** Load a stored connection and check it still works. */
  async function restore() {
    const saved = await api.storage.get(STORAGE_KEY)
    if (!saved || typeof saved.token !== 'string' || typeof saved.server !== 'string') return false
    conn = saved
    const res = await fetch(url(conn.server, 'me'), { headers: headers() }).catch(() => null)
    if (!res) { setState('offline', 'Can’t reach Nihmbus. Retrying…'); return true }
    if (res.status === 401) { await forget('This PopCraft was disconnected in Nihmbus. Connect again with a new code.'); return false }
    if (res.status === 426) { const b = await res.json().catch(() => ({})); setState('outdated', b.error || 'Update the Nihmbus plugin.'); return false }
    const body = await res.json().catch(() => ({}))
    if (body.workspaceName) conn.workspaceName = body.workspaceName
    if (body.device?.name) conn.deviceName = body.device.name
    return true
  }

  // ── Tools (docs/tools.md) ────────────────────────────────────────────────

  async function toolStatus() {
    const [page, selection] = await Promise.all([api.getCurrentPage(), api.getSelection()])
    return {
      plugin: { ...PLUGIN, protocol: EXTENSION_PROTOCOL },
      page,
      selection: (selection || []).slice(0, 50).map((n) => ({ id: n.id, name: n.name, type: n.type })),
    }
  }

  async function toolCall(args) {
    const calls = Array.isArray(args.calls) ? args.calls : [{ method: args.method, args: args.args }]
    if (!calls.length || calls.length > MAX_CALLS) throw new Error(`Pass 1–${MAX_CALLS} calls.`)
    const results = []
    for (let i = 0; i < calls.length; i++) {
      const { method, args: params = [] } = calls[i] || {}
      if (typeof method !== 'string' || !ALLOWED_METHODS.has(method) || typeof api[method] !== 'function') {
        throw new Error(`call ${i} (${method}): not an allowed PopCraft plugin method.`)
      }
      if (!Array.isArray(params)) throw new Error(`call ${i} (${method}): args must be an array of positional arguments.`)
      try {
        const value = await api[method](...params)
        results.push(value === undefined ? null : value)
      } catch (e) {
        throw new Error(`call ${i} (${method}): ${e && e.message ? e.message : String(e)}`)
      }
    }
    return { results }
  }

  async function toolExport(args, command) {
    const format = String(args.format || 'PNG').toUpperCase()
    if (!EXPORT_TYPES[format]) throw new Error('format must be PNG, JPG, WEBP, SVG or PDF.')
    if (typeof args.nodeId !== 'string' || !args.nodeId) throw new Error('nodeId is required.')
    const scale = Math.min(8, Math.max(0.1, Number(args.scale) || 1))
    const node = await api.getNode(args.nodeId)
    if (!node) throw new Error(`No layer with id ${args.nodeId}.`)
    const data = await api.exportNode(args.nodeId, { format, scale })
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const base = String(args.filename || node.name || 'export').replace(/[^\w .-]+/g, '-').trim().slice(0, 100) || 'export'
    const filename = `${base}.${EXPORT_EXT[format]}`
    const grantRes = await fetch(url(conn.server, 'upload'), {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ commandId: command.id, filename, contentType: EXPORT_TYPES[format], size: bytes.byteLength }),
    })
    const grant = await grantRes.json().catch(() => ({}))
    if (!grantRes.ok) throw new Error(grant.error || `Nihmbus refused the upload (${grantRes.status}).`)
    const put = await api.upload(grant.url, { body: bytes, method: grant.method || 'PUT', contentType: EXPORT_TYPES[format], headers: grant.headers || {} })
    if (!put || !put.ok) throw new Error(`Upload failed (${put ? put.status : 'no response'}).`)
    return {
      result: { exported: { nodeId: args.nodeId, format, bytes: bytes.byteLength } },
      files: [{ pathname: grant.pathname, name: filename, contentType: EXPORT_TYPES[format] }],
    }
  }

  async function run(command) {
    const args = command.args && typeof command.args === 'object' ? command.args : {}
    if (command.tool === 'status') return { result: await toolStatus() }
    if (command.tool === 'call') return { result: await toolCall(args) }
    if (command.tool === 'export') return toolExport(args, command)
    throw new Error(`This plugin doesn't know the tool "${command.tool}". Update it.`)
  }

  async function report(body) {
    const res = await fetch(url(conn.server, 'result'), { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
    return res.ok
  }

  async function handle(command) {
    setState('working', command.tool)
    let body
    try {
      const out = await run(command)
      const result = out.result === undefined ? null : out.result
      const size = JSON.stringify(result).length
      if (size > MAX_RESULT_CHARS) throw new Error(`The result is too large (${size} characters). Ask for less, e.g. a smaller outline or fewer layers.`)
      body = { id: command.id, ok: true, result, ...(out.files ? { files: out.files } : {}) }
    } catch (e) {
      body = { id: command.id, ok: false, error: String(e && e.message ? e.message : e).slice(0, 2000) }
    }
    await report(body).catch(() => {})
  }

  /** Poll until stopped, revoked or outdated. */
  async function loop() {
    if (running) return
    running = true
    stopRequested = false
    let failures = 0
    try {
      while (conn && !stopRequested) {
        let res
        try {
          res = await fetch(url(conn.server, 'poll'), { headers: headers() })
        } catch {
          res = null
        }
        if (stopRequested) break
        if (!res || res.status >= 500) {
          setState('offline', 'Can’t reach Nihmbus. Retrying…')
          await sleep(BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)])
          continue
        }
        if (res.status === 401) { await forget('This PopCraft was disconnected in Nihmbus. Connect again with a new code.'); break }
        if (res.status === 426) { const b = await res.json().catch(() => ({})); setState('outdated', b.error || 'Update the Nihmbus plugin.'); break }
        if (res.status === 403) {
          setState('paused', 'The PopCraft extension is disabled in Nihmbus.')
          await sleep(BACKOFF_MS[BACKOFF_MS.length - 1])
          continue
        }
        if (!res.ok) { setState('offline', `Nihmbus answered ${res.status}. Retrying…`); await sleep(BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)]); continue }
        failures = 0
        const { command } = await res.json().catch(() => ({ command: null }))
        if (command) await handle(command)
        setState('connected')
      }
    } finally {
      running = false
    }
  }

  function stop() { stopRequested = true }

  async function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    try {
      if (msg.type === 'ready') return void setState(state.status, state.detail)
      if (msg.type === 'pair') {
        await pair(msg)
        setState('connected')
        void loop()
        return
      }
      if (msg.type === 'disconnect') { stop(); await forget('Disconnected. You can connect again with a new code.'); return }
      if (msg.type === 'hide') return void (await api.hideUI())
    } catch (e) {
      setState(conn ? state.status : 'disconnected', e && e.message ? e.message : String(e))
    }
  }

  async function start() {
    api.ui.onmessage = (m) => void onMessage(m)
    await api.showUI({ width: 320, height: 300, title: 'Nihmbus' })
    if (await restore()) {
      setState('connected')
      void loop()
    } else if (state.status === 'idle') {
      setState('disconnected')
    }
  }

  return { start, stop, pair, loop, run, handle, onMessage, get state() { return state }, get connection() { return conn } }
}

if (typeof popcraft !== 'undefined' && !globalThis.__NIHMBUS_TEST__) {
  createConnector({ api: popcraft, fetch: (...a) => fetch(...a) }).start()
}
