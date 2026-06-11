import {strict as assert} from 'node:assert'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {pathToFileURL} from 'node:url'

import {isCliEntrypoint} from './release-version-utils.mjs'
import {
  assertReleaseVersionAllowed,
  packageVersionFromReleaseTag,
  setPackageVersionFromReleaseTag,
} from './set-package-version-from-release-tag.mjs'

describe('packageVersionFromReleaseTag', () => {
  it('strips the v prefix from beta, alpha, rc, and stable tags', () => {
    assert.equal(packageVersionFromReleaseTag('v0.1.0-beta.2'), '0.1.0-beta.2')
    assert.equal(packageVersionFromReleaseTag('v0.1.0-alpha.1'), '0.1.0-alpha.1')
    assert.equal(packageVersionFromReleaseTag('v0.1.0-rc.1'), '0.1.0-rc.1')
    assert.equal(packageVersionFromReleaseTag('v0.1.0'), '0.1.0')
  })

  it('rejects tags without v prefixes or valid package versions', () => {
    assert.throws(() => packageVersionFromReleaseTag('0.1.0'), /must start with v/)
    assert.throws(() => packageVersionFromReleaseTag('v0.1'), /Unsupported release tag version/)
  })
})

describe('setPackageVersionFromReleaseTag', () => {
  it('updates package.json to the tag-derived version and preserves other fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-sdk-package-version-'))
    const packageJsonPath = join(dir, 'package.json')

    try {
      writeFileSync(
        packageJsonPath,
        JSON.stringify(
          {
            name: '@depot/sandbox',
            version: '0.1.0-beta.1',
            private: false,
          },
          null,
          2,
        ) + '\n',
      )

      assert.equal(setPackageVersionFromReleaseTag({tag: 'v0.1.0-beta.2', packageJsonPath}), '0.1.0-beta.2')

      assert.deepEqual(JSON.parse(readFileSync(packageJsonPath, 'utf8')), {
        name: '@depot/sandbox',
        version: '0.1.0-beta.2',
        private: false,
      })
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })
})

describe('assertReleaseVersionAllowed', () => {
  it('allows exact release versions', () => {
    assert.doesNotThrow(() =>
      assertReleaseVersionAllowed({releaseVersion: '0.1.0-beta.1', packageVersion: '0.1.0-beta.1'}),
    )
  })

  it('allows advancement within the package prerelease channel', () => {
    assert.doesNotThrow(() =>
      assertReleaseVersionAllowed({releaseVersion: '0.1.0-beta.2', packageVersion: '0.1.0-beta.1'}),
    )
  })

  it('rejects release versions older than the published prerelease channel', () => {
    assert.throws(
      () =>
        assertReleaseVersionAllowed({
          releaseVersion: '0.1.0-beta.2',
          packageVersion: '0.1.0-beta.1',
          publishedVersions: ['0.1.0-beta.10'],
        }),
      /not newer than the latest published prerelease/,
    )
  })

  it('allows release versions newer than the published prerelease channel', () => {
    assert.doesNotThrow(() =>
      assertReleaseVersionAllowed({
        releaseVersion: '0.1.0-beta.11',
        packageVersion: '0.1.0-beta.1',
        publishedVersions: ['0.1.0-beta.10'],
      }),
    )
  })

  it('rejects unrelated manual release versions', () => {
    assert.throws(
      () => assertReleaseVersionAllowed({releaseVersion: '1.0.0', packageVersion: '0.1.0-beta.1'}),
      /stable releases do not auto-advance/,
    )
    assert.throws(
      () => assertReleaseVersionAllowed({releaseVersion: '0.1.0-alpha.1', packageVersion: '0.1.0-beta.1'}),
      /not an allowed advancement/,
    )
    assert.throws(
      () => assertReleaseVersionAllowed({releaseVersion: '0.1.0-beta.1', packageVersion: '0.1.0-beta.2'}),
      /not an allowed advancement/,
    )
  })
})

describe('isCliEntrypoint', () => {
  it('matches scripts invoked with relative or absolute argv paths', () => {
    const scriptPath = join(process.cwd(), 'scripts/set-package-version-from-release-tag.mjs')
    const moduleUrl = pathToFileURL(scriptPath).href

    assert.equal(isCliEntrypoint(moduleUrl, 'scripts/set-package-version-from-release-tag.mjs'), true)
    assert.equal(isCliEntrypoint(moduleUrl, scriptPath), true)
    assert.equal(isCliEntrypoint(moduleUrl, undefined), false)
  })
})
