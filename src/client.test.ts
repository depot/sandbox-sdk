import assert from 'node:assert'
import test from 'node:test'
import {DEFAULT_ENDPOINT, applyAuthHeaders, createClient, resolveClientOpts} from './client.js'

test('createClient accepts an explicit token and uses the default endpoint', () => {
  const client = createClient({token: 'explicit'})
  assert.equal(client.endpoint, DEFAULT_ENDPOINT)
})

test('resolveClientOpts falls back to DEPOT_TOKEN', () => {
  const previous = process.env.DEPOT_TOKEN
  process.env.DEPOT_TOKEN = 'from-env'
  try {
    assert.deepEqual(resolveClientOpts(), {token: 'from-env'})
  } finally {
    restoreEnv('DEPOT_TOKEN', previous)
  }
})

test('createClient uses DEPOT_TOKEN when the token option is omitted', () => {
  const previous = process.env.DEPOT_TOKEN
  process.env.DEPOT_TOKEN = 'from-env'
  try {
    const client = createClient()
    assert.equal(client.endpoint, DEFAULT_ENDPOINT)
  } finally {
    restoreEnv('DEPOT_TOKEN', previous)
  }
})

test('resolveClientOpts gives explicit token precedence over DEPOT_TOKEN', () => {
  const previous = process.env.DEPOT_TOKEN
  process.env.DEPOT_TOKEN = 'from-env'
  try {
    assert.equal(resolveClientOpts({token: 'explicit'}).token, 'explicit')
  } finally {
    restoreEnv('DEPOT_TOKEN', previous)
  }
})

test('createClient preserves a custom endpoint', () => {
  const client = createClient({token: 'explicit', endpoint: 'https://sandbox.example.test'})
  assert.equal(client.endpoint, 'https://sandbox.example.test')
})

test('applyAuthHeaders sets Authorization and optional organization headers', () => {
  const headers = new Map<string, string>()
  applyAuthHeaders(
    {
      header: {
        set: (name, value) => headers.set(name, value),
      },
    },
    {token: 'explicit', orgID: 'org_123'},
  )

  assert.equal(headers.get('Authorization'), 'Bearer explicit')
  assert.equal(headers.get('x-depot-org'), 'org_123')
})

test('applyAuthHeaders omits x-depot-org when no organization is configured', () => {
  const headers = new Map<string, string>()
  applyAuthHeaders(
    {
      header: {
        set: (name, value) => headers.set(name, value),
      },
    },
    {token: 'explicit'},
  )

  assert.equal(headers.get('Authorization'), 'Bearer explicit')
  assert.equal(headers.has('x-depot-org'), false)
})

test('createClient rejects when no explicit token or DEPOT_TOKEN exists', () => {
  const previous = process.env.DEPOT_TOKEN
  delete process.env.DEPOT_TOKEN
  try {
    assert.throws(() => createClient(), /createClient requires a token/)
  } finally {
    restoreEnv('DEPOT_TOKEN', previous)
  }
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
