import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Load the browser half in Node with the same globals the Web module loader
 * provides: a `window.__ModuleLoader__` that captures the factory, and a
 * `require` returning the React runtime. This catches syntax and registration
 * defects without a browser.
 */

let definition
globalThis.window = {
  __ModuleLoader__: {
    load(candidate) {
      definition = candidate
    },
  },
}

await import('../client.js')

const fakeReact = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [initial, () => {}]
  },
  useEffect() {},
  useRef(initial) {
    return { current: initial }
  },
}

function loadModule() {
  return definition.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require ${name}`)
  })
}

test('the client module registers the expected package id', () => {
  assert.equal(definition.id, 'dsh-memory-harness')
})

test('apply registers settings, the memory panel and the sidebar entry', () => {
  const module = loadModule()
  assert.deepEqual(module.inject, ['slots', 'locale', 'connection'])

  const registrations = []
  const ctx = {
    get(name) {
      if (name === 'locale') return { resolveText: (text) => text.en }
      if (name === 'connection') return { rpc: { call: async () => ({ ok: true, value: {} }) } }
      return undefined
    },
    slots: {
      inject(owner, callback) {
        registrations.push([owner, callback()])
      },
      register(options, component) {
        return { options, component }
      },
    },
  }
  module.apply(ctx)

  const section = registrations.find(([owner]) => owner === 'settings.section')
  assert.ok(section, 'settings.section registration missing')
  assert.equal(section[1].options.id, 'memory')
  assert.equal(section[1].options.order, 25)
  assert.equal(section[1].options.label(), 'Memory')
  assert.equal(typeof section[1].component, 'function')

  const icon = registrations.find(([owner]) => owner === 'settings.section.icon')
  assert.ok(icon, 'settings.section.icon registration missing')
  assert.equal(icon[1].options.id, 'memory')
  assert.equal(typeof icon[1].component, 'function')
  const rendered = icon[1].component({ size: 18, active: true })
  assert.equal(rendered.type, 'svg')
  assert.equal(rendered.props.width, 18)

  const main = registrations.find(([owner]) => owner === 'main')
  assert.ok(main, 'main panel registration missing')
  assert.equal(main[1].options.key, 'memory')
  assert.equal(typeof main[1].component, 'function')

  const dock = registrations.find(([owner]) => owner === 'conversation.input.dock')
  assert.ok(dock, 'conversation.input.dock registration missing')
  assert.equal(dock[1].options.id, 'memory-recall')
  assert.equal(dock[1].options.order, 30)

  const panel = registrations.find(([owner]) => owner === 'sidebar.panellist')
  assert.ok(panel, 'sidebar.panellist registration missing')
  assert.equal(panel[1].options.id, 'memory')
  assert.equal(panel[1].options.order, 20)
  assert.equal(panel[1].options.label(), 'Memory')
  assert.equal(typeof panel[1].component, 'function')
})

test('the settings page and the memory panel render their initial state', () => {
  const module = loadModule()
  const registrations = []
  const ctx = {
    get(name) {
      if (name === 'locale') return { resolveText: (text) => text.en }
      if (name === 'connection') return { rpc: { call: async () => ({ ok: true, value: {} }) } }
      return undefined
    },
    slots: {
      inject(owner, callback) {
        registrations.push([owner, callback()])
      },
      register(options, component) {
        return { options, component }
      },
    },
  }
  module.apply(ctx)
  const fakeClient = {
    list: async () => ({ memories: [], total: 0 }),
    search: async () => ({ memories: [], total: 0 }),
    save: async () => ({}),
    update: async () => ({}),
    remove: async () => ({}),
    stats: async () => ({ count: 0, pendingEmbeddings: 0, embedder: { ok: true, latencyMs: 1 }, embedding: { model: 'fake', dimensions: 3 } }),
    getSettings: async () => ({
      embedding: { baseURL: 'http://x', model: 'm', dimensions: 3, timeoutMs: 3000, queryInstruction: '', apiKeySet: true },
      capture: { defaultScope: 'workspace', dedupeThreshold: 0.93 },
      inject: { coreMemories: 10, coreMinImportance: 3, includeWorkspace: true },
      retrieval: { defaultLimit: 5 },
    }),
    setSettings: async () => ({}),
  }

  const section = registrations.find(([owner]) => owner === 'settings.section')[1]
  const settingsWrapper = section.component({ close: () => {} })
  assert.equal(typeof settingsWrapper.type, 'function', 'wrapper should render the settings component')
  const settingsPage = settingsWrapper.type({ ...settingsWrapper.props, client: fakeClient, t: (en) => en })
  assert.equal(settingsPage.type, 'div')
  assert.equal(settingsPage.props.className, 'dsh-memory-page')

  const main = registrations.find(([owner]) => owner === 'main')[1]
  const browserWrapper = main.component({})
  assert.equal(typeof browserWrapper.type, 'function', 'wrapper should render the browser component')
  const browserPage = browserWrapper.type({ ...browserWrapper.props, client: fakeClient, t: (en) => en })
  assert.equal(browserPage.type, 'div')
  assert.equal(browserPage.props.className, 'dsh-memory-main')
  const scroller = browserPage.children.find(
    (child) => child !== null && typeof child === 'object' && child.props?.className === 'dsh-memory-scroll',
  )
  assert.ok(scroller, 'the panel must own a full-height scroll container')
  assert.equal(typeof scroller.props.onScroll, 'function', 'the scroll container must trigger pagination near the bottom')
  const page = scroller.children.find(
    (child) => child !== null && typeof child === 'object' && child.props?.className === 'dsh-memory-page',
  )
  assert.ok(page, 'the scroll container should hold the page content')
})

test('the recall dock renders both rating axes and a submit action', () => {
  const state = {
    enabled: true,
    recalls: [{
      recallId: 'rc_test',
      at: Date.now(),
      turn: 2,
      source: 'search',
      memoryIds: ['m_test'],
      ratedCount: 0,
      memories: [{
        id: 'm_test',
        missing: false,
        status: 'active',
        text: 'TypeScript project memory',
        kind: 'project',
        scope: 'workspace',
        importance: 3,
        ratings: { relevance: null, content: null },
        rating: null,
      }],
    }],
  }
  const queue = [state, true, { 'rc_test:m_test:relevance': 'irrelevant' }, false, null, [], 0, Date.now(), false, null]
  let index = 0
  const queuedReact = {
    ...fakeReact,
    useState(initial) {
      const value = index < queue.length ? queue[index] : initial
      index += 1
      return [value, () => {}]
    },
  }
  const module = definition.factory((name) => {
    if (name === 'react') return queuedReact
    throw new Error(`unexpected require ${name}`)
  })
  const registrations = []
  const ctx = {
    get(name) {
      if (name === 'locale') return { resolveText: (text) => text.en }
      if (name === 'connection') return { rpc: { call: async () => ({ ok: true, value: {} }) } }
      return undefined
    },
    slots: {
      inject(owner, callback) { registrations.push([owner, callback()]) },
      register(options, component) { return { options, component } },
    },
  }
  module.apply(ctx)
  const dock = registrations.find(([owner]) => owner === 'conversation.input.dock')[1]
  const wrapper = dock.component({ sessionId: 's-test', useSession: () => false, client: {}, t: (en) => en })
  const rendered = wrapper.type({ ...wrapper.props })
  const texts = []
  const visit = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') { texts.push(node); return }
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (typeof node === 'object' && Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit(rendered)
  const all = texts.join(' | ')
  assert.ok(all.includes('Relevant this turn?'), 'relevance axis missing')
  assert.ok(all.includes('Memory itself (optional)'), 'content axis missing')
  assert.ok(all.includes('Submit (1)'), 'dirty submit action missing')
  assert.ok(all.includes('Still valid'), 'content rating options missing')
})
