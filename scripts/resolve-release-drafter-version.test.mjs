import {strict as assert} from 'node:assert'
import {describe, it} from 'node:test'

import {resolveReleaseDraftVersion} from './resolve-release-drafter-version.mjs'

describe('resolveReleaseDraftVersion', () => {
  it('uses the package version when no release or tag owns it', () => {
    assert.deepEqual(resolveReleaseDraftVersion({packageVersion: '0.1.0-beta.1'}), {
      version: '0.1.0-beta.1',
      tag: 'v0.1.0-beta.1',
      name: '@depot/sandbox 0.1.0-beta.1',
      prerelease: 'false',
    })
  })

  it('reuses an existing draft release for the package version', () => {
    assert.equal(
      resolveReleaseDraftVersion({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: true}],
      }).version,
      '0.1.0-beta.1',
    )
  })

  it('advances a beta prerelease when the package version is published', () => {
    assert.equal(
      resolveReleaseDraftVersion({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: false}],
      }).version,
      '0.1.0-beta.2',
    )
  })

  it('advances a prerelease when the package version has a git tag', () => {
    assert.equal(
      resolveReleaseDraftVersion({
        packageVersion: '0.1.0-beta.1',
        tags: ['v0.1.0-beta.1'],
      }).version,
      '0.1.0-beta.2',
    )
  })

  it('treats a draft plus a git tag as consumed', () => {
    assert.equal(
      resolveReleaseDraftVersion({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: true}],
        tags: ['v0.1.0-beta.1'],
      }).version,
      '0.1.0-beta.2',
    )
  })

  it('keeps advancing until it finds an unused candidate', () => {
    assert.equal(
      resolveReleaseDraftVersion({
        packageVersion: '0.1.0-beta.1',
        releases: [{tag_name: 'v0.1.0-beta.1', draft: false}],
        tags: ['v0.1.0-beta.2'],
      }).version,
      '0.1.0-beta.3',
    )
  })

  it('treats npm-published versions as consumed', () => {
    assert.equal(
      resolveReleaseDraftVersion({
        packageVersion: '0.1.0-beta.1',
        npmVersions: ['0.1.0-beta.1', '0.1.0-beta.2'],
      }).version,
      '0.1.0-beta.3',
    )
  })

  it('advances alpha independently of beta', () => {
    assert.equal(
      resolveReleaseDraftVersion({
        packageVersion: '0.1.0-alpha.1',
        tags: ['v0.1.0-alpha.1', 'v0.1.0-beta.1'],
      }).version,
      '0.1.0-alpha.2',
    )
  })

  it('advances rc and still emits latest and normal-release status', () => {
    assert.deepEqual(
      resolveReleaseDraftVersion({
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
    assert.deepEqual(resolveReleaseDraftVersion({packageVersion: '0.1.0'}), {
      version: '0.1.0',
      tag: 'v0.1.0',
      name: '@depot/sandbox 0.1.0',
      prerelease: 'false',
    })
  })

  it('fails instead of auto-advancing a consumed stable version', () => {
    assert.throws(
      () =>
        resolveReleaseDraftVersion({
          packageVersion: '0.1.0',
          tags: ['v0.1.0'],
        }),
      /already exists; bump package\.json intentionally/,
    )
  })

  it('rejects malformed package versions', () => {
    assert.throws(() => resolveReleaseDraftVersion({packageVersion: '0.1'}), /Unsupported package version/)
    assert.throws(() => resolveReleaseDraftVersion({packageVersion: ''}), /package.json version missing/)
    assert.throws(
      () => resolveReleaseDraftVersion({packageVersion: '0.1.0-beta.9007199254740992'}),
      /Unsupported prerelease number/,
    )
    assert.throws(() => resolveReleaseDraftVersion({packageVersion: '0.1.0-beta.01'}), /Unsupported prerelease number/)
  })
})
