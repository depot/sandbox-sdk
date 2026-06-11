import {readFileSync} from 'node:fs'

import {
  fetchNpmPackageVersions,
  formatVersion,
  isCliEntrypoint,
  parseVersion,
  prereleaseNumbersInChannel,
  requestTimeoutMs,
  writeGithubOutput,
} from './release-version-utils.mjs'

export function resolveReleaseDraftVersion({packageName, packageVersion, releases = [], tags = [], npmVersions = []}) {
  if (!packageName) {
    throw new Error('package.json name missing')
  }

  const parsed = parseVersion(packageVersion)
  let candidate = nextCandidateAtOrAfterObservedChannel({candidate: parsed, releases, tags, npmVersions})

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

function nextCandidateAtOrAfterObservedChannel({candidate, releases, tags, npmVersions}) {
  if (!candidate.prerelease) {
    return candidate
  }

  const consumedMax = maxNumber([
    ...prereleaseNumbersInChannel(
      tags.map((tag) => tag.replace(/^v/, '')),
      candidate,
    ),
    ...prereleaseNumbersInChannel(npmVersions, candidate),
    ...prereleaseNumbersInChannel(
      releases
        .filter((release) => !release.draft)
        .map(releaseTag)
        .filter(Boolean)
        .map((tag) => tag.replace(/^v/, '')),
      candidate,
    ),
  ])
  const draftMax = maxNumber(
    prereleaseNumbersInChannel(
      releases
        .filter((release) => release.draft)
        .map(releaseTag)
        .filter(Boolean)
        .map((tag) => tag.replace(/^v/, '')),
      candidate,
    ),
  )
  const floor = Math.max(candidate.prerelease.number, consumedMax + 1)

  return {
    ...candidate,
    prerelease: {
      ...candidate.prerelease,
      number: draftMax >= floor ? draftMax : floor,
    },
  }
}

function maxNumber(numbers) {
  return numbers.length > 0 ? Math.max(...numbers) : 0
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

export async function fetchReleaseState(repository, token, packageName) {
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required')
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN is required')
  }
  if (!packageName) {
    throw new Error('package.json name missing')
  }

  const baseUrl = `https://api.github.com/repos/${repository}`
  const releases = await fetchAllPages(`${baseUrl}/releases?per_page=100`, token)
  const refs = await fetchAllPages(`${baseUrl}/git/matching-refs/tags/?per_page=100`, token)

  return {
    releases,
    tags: refs.map((ref) => ref.ref.replace(/^refs\/tags\//, '')),
    npmVersions: await fetchNpmPackageVersions(packageName),
  }
}

function readPackageMetadata(packageJsonPath) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  if (!pkg.name) {
    throw new Error('package.json name missing')
  }
  if (!pkg.version) {
    throw new Error('package.json version missing')
  }
  return {packageName: pkg.name, packageVersion: pkg.version}
}

async function main() {
  const packageJsonPath = process.env.PACKAGE_JSON_PATH ?? 'package.json'
  const {packageName, packageVersion} = readPackageMetadata(packageJsonPath)
  const {releases, tags, npmVersions} = await fetchReleaseState(
    process.env.GITHUB_REPOSITORY,
    process.env.GITHUB_TOKEN,
    packageName,
  )
  const result = resolveReleaseDraftVersion({packageName, packageVersion, releases, tags, npmVersions})
  writeGithubOutput(result)
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
