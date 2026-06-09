import assert from 'node:assert'
import test from 'node:test'
import {DEFAULT_ENDPOINT, applyAuthHeaders, createClient} from './client.js'

test('createClient accepts an explicit token and uses the default endpoint', () => {
  const client = createClient({token: 'explicit'})
  assert.equal(client.endpoint, DEFAULT_ENDPOINT)
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

test('createClient rejects when the caller passes a missing DEPOT_TOKEN', () => {
  const previous = process.env.DEPOT_TOKEN
  delete process.env.DEPOT_TOKEN
  try {
    assert.throws(() => createClient({token: process.env.DEPOT_TOKEN!}), /createClient requires a token/)
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
