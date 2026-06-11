import {strict as assert} from 'node:assert'
import {describe, it} from 'node:test'

import {fetchReleaseState, resolveReleaseDraftVersion} from './resolve-release-drafter-version.mjs'

const packageName = '@depot/sandbox'

function resolve(options) {
  return resolveReleaseDraftVersion({packageName, ...options})
}

describe('resolveReleaseDraftVersion', () => {
  it('uses the package version when no release or tag owns it', () => {
    assert.deepEqual(resolve({packageVersion: '0.1.0-beta.1'}), {
      version: '0.1.0-beta.1',
      tag: 'v0.1.0-beta.1',
      name: '@depot/sandbox 0.1.0-beta.1',
      prerelease: 'false',
    })
  })

  it('reuses an existing draft release for the package version', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: true}],
      }).version,
      '0.1.0-beta.1',
    )
  })

  it('advances a beta prerelease when the package version is published', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: false}],
      }).version,
      '0.1.0-beta.2',
    )
  })

  it('advances a prerelease when the package version has a git tag', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        tags: ['v0.1.0-beta.1'],
      }).version,
      '0.1.0-beta.2',
    )
  })

  it('treats a draft plus a git tag as consumed', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: true}],
        tags: ['v0.1.0-beta.1'],
      }).version,
      '0.1.0-beta.2',
    )
  })

  it('keeps advancing until it finds an unused candidate', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: false}],
        tags: ['v0.1.0-beta.2'],
      }).version,
      '0.1.0-beta.3',
    )
  })

  it('treats npm-published versions as consumed', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        npmVersions: ['0.1.0-beta.1', '0.1.0-beta.2'],
      }).version,
      '0.1.0-beta.3',
    )
  })

  it('skips lower available prereleases when a higher channel version is consumed', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        tags: ['v0.1.0-beta.10'],
      }).version,
      '0.1.0-beta.11',
    )
  })

  it('ignores stale lower drafts when a higher channel version is consumed', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.2', draft: true}],
        npmVersions: ['0.1.0-beta.10'],
      }).version,
      '0.1.0-beta.11',
    )
  })

  it('reuses a higher draft when it is newer than consumed channel versions', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.11', draft: true}],
        npmVersions: ['0.1.0-beta.10'],
      }).version,
      '0.1.0-beta.11',
    )
  })

  it('advances alpha independently of beta', () => {
    assert.equal(
      resolve({
        packageVersion: '0.1.0-alpha.1',
        tags: ['v0.1.0-alpha.1', 'v0.1.0-beta.1'],
      }).version,
      '0.1.0-alpha.2',
    )
  })

  it('advances rc and still emits latest and normal-release status', () => {
    assert.deepEqual(
      resolve({
        packageVersion: '0.1.0-rc.1',
        tags: ['v0.1.0-rc.1'],
      }),
      {
        version: '0.1.0-rc.2',
        tag: 'v0.1.0-rc.2',
        name: '@depot/sandbox 0.1.0-rc.2',
        prerelease: 'false',
      },
    )
  })

  it('uses an available stable version as a normal latest release', () => {
    assert.deepEqual(resolve({packageVersion: '0.1.0'}), {
      version: '0.1.0',
      tag: 'v0.1.0',
      name: '@depot/sandbox 0.1.0',
      prerelease: 'false',
    })
  })

  it('fails instead of auto-advancing a consumed stable version', () => {
    assert.throws(
      () =>
        resolve({
          packageVersion: '0.1.0',
          tags: ['v0.1.0'],
        }),
      /already exists; bump package\.json intentionally/,
    )
  })

  it('rejects malformed package versions', () => {
    assert.throws(() => resolve({packageVersion: '0.1'}), /Unsupported package version/)
    assert.throws(() => resolve({packageVersion: ''}), /package.json version missing/)
    assert.throws(() => resolve({packageVersion: '0.1.0-beta.9007199254740992'}), /Unsupported prerelease number/)
    assert.throws(() => resolve({packageVersion: '0.1.0-beta.01'}), /Unsupported prerelease number/)
  })

  it('requires a package name for release names', () => {
    assert.throws(() => resolveReleaseDraftVersion({packageVersion: '0.1.0-beta.1'}), /package\.json name missing/)
  })
})

describe('fetchReleaseState', () => {
  it('paginates GitHub tag refs before resolving consumed versions', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    const responses = [
      {
        body: [],
      },
      {
        body: [{ref: 'refs/tags/v0.1.0-beta.1'}],
        link: '<https://api.github.com/repos/depot/sandbox-sdk/git/matching-refs/tags/?per_page=100&page=2>; rel="next"',
      },
      {
        body: [{ref: 'refs/tags/v0.1.0-beta.2'}],
      },
      {
        body: {versions: {}},
      },
    ]

    globalThis.fetch = async (url) => {
      requests.push(String(url))
      const response = responses.shift()
      assert.ok(response, `unexpected fetch: ${url}`)

      return new Response(JSON.stringify(response.body), {
        status: 200,
        headers: response.link ? {link: response.link} : {},
      })
    }

    try {
      const state = await fetchReleaseState('depot/sandbox-sdk', 'token', packageName)

      assert.deepEqual(state.tags, ['v0.1.0-beta.1', 'v0.1.0-beta.2'])
      assert.equal(
        resolveReleaseDraftVersion({
          packageName,
          packageVersion: '0.1.0-beta.1',
          tags: state.tags,
          npmVersions: state.npmVersions,
          releases: state.releases,
        }).version,
        '0.1.0-beta.3',
      )
      assert.deepEqual(requests, [
        'https://api.github.com/repos/depot/sandbox-sdk/releases?per_page=100',
        'https://api.github.com/repos/depot/sandbox-sdk/git/matching-refs/tags/?per_page=100',
        'https://api.github.com/repos/depot/sandbox-sdk/git/matching-refs/tags/?per_page=100&page=2',
        'https://registry.npmjs.org/%40depot%2Fsandbox',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
