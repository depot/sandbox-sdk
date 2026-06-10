import {appendFileSync, readFileSync} from 'node:fs'

import {formatVersion, parseVersion} from './release-version-utils.mjs'

const packageName = '@depot/sandbox'
const requestTimeoutMs = 15000

export function resolveReleaseDraftVersion({packageVersion, releases = [], tags = [], npmVersions = []}) {
  const parsed = parseVersion(packageVersion)
  let candidate = parsed

  while (true) {
    const version = formatVersion(candidate)
    const tag = `v${version}`
    const state = candidateState({tag, version, releases, tags, npmVersions})

    if (state === 'available' || state === 'draft') {
      return {
        version,
        tag,
        name: `${packageName} ${version}`,
        prerelease: 'false',
      }
    }

    if (!candidate.prerelease) {
      throw new Error(`Release tag ${tag} already exists; bump package.json intentionally.`)
    }

    candidate = {
      ...candidate,
      prerelease: {
        identifier: candidate.prerelease.identifier,
        number: candidate.prerelease.number + 1,
      },
    }
  }
}

function candidateState({tag, version, releases, tags, npmVersions}) {
  if (tags.includes(tag) || npmVersions.includes(version)) {
    return 'consumed'
  }

  const matching = releases.filter((release) => releaseTag(release) === tag)
  if (matching.some((release) => !release.draft)) {
    return 'consumed'
  }

  if (matching.some((release) => release.draft)) {
    return 'draft'
  }

  return 'available'
}

function releaseTag(release) {
  return release.tag_name ?? release.tagName ?? release.tag
}

async function fetchAllPages(url, token) {
  const items = []
  let next = url

  while (next) {
    const response = await fetch(next, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
    })

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} (${next})`)
    }

    items.push(...(await response.json()))
    next = nextPage(response.headers.get('link'))
  }

  return items
}

function nextPage(linkHeader) {
  if (!linkHeader) {
    return null
  }

  for (const part of linkHeader.split(',')) {
    const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(part)
    if (match?.[2] === 'next') {
      return match[1]
    }
  }

  return null
}

async function fetchNpmVersions() {
  const response = await fetch('https://registry.npmjs.org/@depot%2fsandbox', {
    headers: {accept: 'application/vnd.npm.install-v1+json'},
    signal: AbortSignal.timeout(requestTimeoutMs),
  })

  if (response.status === 404) {
    return []
  }

  if (!response.ok) {
    throw new Error(`npm registry request failed: ${response.status} ${response.statusText}`)
  }

  const metadata = await response.json()
  return Object.keys(metadata.versions ?? {})
}

export async function fetchReleaseState(repository, token) {
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required')
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const baseUrl = `https://api.github.com/repos/${repository}`
  const releases = await fetchAllPages(`${baseUrl}/releases?per_page=100`, token)
  const refs = await fetchAllPages(`${baseUrl}/git/matching-refs/tags/?per_page=100`, token)

  return {
    releases,
    tags: refs.map((ref) => ref.ref.replace(/^refs\/tags\//, '')),
    npmVersions: await fetchNpmVersions(),
  }
}

function readPackageVersion(packageJsonPath) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  if (!pkg.version) {
    throw new Error('package.json version missing')
  }
  return pkg.version
}

function writeGithubOutput(values) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) {
    for (const [key, value] of Object.entries(values)) {
      console.log(`${key}=${value}`)
    }
    return
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`)
  appendFileSync(output, `${lines.join('\n')}\n`)
}

async function main() {
  const packageJsonPath = process.env.PACKAGE_JSON_PATH ?? 'package.json'
  const packageVersion = readPackageVersion(packageJsonPath)
  const {releases, tags, npmVersions} = await fetchReleaseState(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN)
  const result = resolveReleaseDraftVersion({packageVersion, releases, tags, npmVersions})
  writeGithubOutput(result)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
