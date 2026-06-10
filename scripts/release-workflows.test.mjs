import {strict as assert} from 'node:assert'
import {readFileSync} from 'node:fs'
import {describe, it} from 'node:test'

function read(path) {
  return readFileSync(path, 'utf8')
}

function indexOfOrThrow(contents, needle) {
  const index = contents.indexOf(needle)
  assert.notEqual(index, -1, `Expected to find: ${needle}`)
  return index
}

describe('release workflow contracts', () => {
  it('wires release-drafter to resolver outputs and normal release status', () => {
    const workflow = read('.github/workflows/release-drafter.yml')
    const config = read('.github/release-drafter.yml')

    assert.match(workflow, /id: release-version/)
    assert.match(workflow, /run: node scripts\/resolve-release-drafter-version\.mjs/)
    assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.BOT_PUBLIC_GITHUB_TOKEN \}\}/)
    assert.match(workflow, /name: \$\{\{ steps\.release-version\.outputs\.name \}\}/)
    assert.match(workflow, /tag: \$\{\{ steps\.release-version\.outputs\.tag \}\}/)
    assert.match(workflow, /version: \$\{\{ steps\.release-version\.outputs\.version \}\}/)
    assert.match(workflow, /prerelease: \$\{\{ steps\.release-version\.outputs\.prerelease \}\}/)
    assert.match(
      workflow,
      /concurrency:\n  group: release-drafter-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false/,
    )

    assert.doesNotMatch(config, /^prerelease:/m)
    assert.doesNotMatch(config, /^prerelease-identifier:/m)
  })

  it('sets package version from the release tag before validation and publishes latest', () => {
    const workflow = read('.github/workflows/release.yml')
    const pkg = JSON.parse(read('package.json'))

    const setVersion = indexOfOrThrow(workflow, 'run: node scripts/set-package-version-from-release-tag.mjs')
    const validate = indexOfOrThrow(workflow, 'run: pnpm run validate')
    const publish = indexOfOrThrow(workflow, 'run: npm publish --access public --tag latest')

    assert.ok(setVersion < validate, 'release tag version must be applied before validation')
    assert.ok(validate < publish, 'package must be validated before publish')
    assert.match(workflow, /RELEASE_TAG: \$\{\{ github\.event\.release\.tag_name \}\}/)
    assert.equal(pkg.publishConfig?.tag, undefined)
  })

  it('keeps repair workflow manual, verifies state before mutation, and never publishes', () => {
    const workflow = read('.github/workflows/repair-release-metadata.yml')

    assert.match(workflow, /workflow_dispatch:/)
    assert.doesNotMatch(workflow, /^  push:/m)
    assert.doesNotMatch(workflow, /^  release:/m)
    assert.doesNotMatch(workflow, /npm publish/)
    assert.doesNotMatch(workflow, /tag="\$\{\{ inputs\.tag \}\}"/)
    assert.match(workflow, /tag="\$\{RELEASE_TAG\}"/)
    assert.match(workflow, /RELEASE_TAG: \$\{\{ inputs\.tag \}\}/)
    assert.match(
      workflow,
      /out="\$\(npm view "@depot\/sandbox@\$\{VERSION\}" version --registry https:\/\/registry\.npmjs\.org\)"/,
    )
    assert.match(workflow, /\[\[ -z "\$\{out\}" \]\]/)

    const verifyRelease = indexOfOrThrow(workflow, 'name: Verify GitHub release and tag')
    const verifyNpm = indexOfOrThrow(workflow, 'name: Verify npm package version')
    const verifyToken = indexOfOrThrow(workflow, 'name: Verify npm token secret')
    const patchRelease = indexOfOrThrow(workflow, 'name: Mark GitHub release as normal release')
    const moveLatest = indexOfOrThrow(workflow, 'name: Move npm latest dist-tag')

    assert.ok(verifyRelease < patchRelease, 'GitHub release must be verified before patching')
    assert.ok(verifyNpm < moveLatest, 'npm package version must be verified before moving latest')
    assert.ok(verifyToken < patchRelease, 'NPM_TOKEN must be verified before any metadata mutation')
    assert.ok(patchRelease < moveLatest, 'GitHub release status should be repaired before npm latest moves')
    assert.match(workflow, /-f prerelease=false/)
    assert.match(workflow, /npm dist-tag add "@depot\/sandbox@/)
    assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/)
  })
})
