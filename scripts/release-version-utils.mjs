import {appendFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

export const npmRegistryUrl = 'https://registry.npmjs.org'
export const requestTimeoutMs = 15000

// This parser is deliberately narrower than full semver: no build metadata,
// and prereleases must be one identifier plus one numeric component.
export function parseVersion(version) {
  if (!version) {
    throw new Error('package.json version missing')
  }

  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+)\.(\d+))?$/.exec(version)
  if (!match) {
    throw new Error(`Unsupported package version: ${version}`)
  }

  const major = parseNumericIdentifier(match[1], 'major')
  const minor = parseNumericIdentifier(match[2], 'minor')
  const patch = parseNumericIdentifier(match[3], 'patch')

  return {
    major,
    minor,
    patch,
    prerelease: match[4]
      ? {
          identifier: match[4],
          number: parseNumericIdentifier(match[5], 'prerelease number'),
        }
      : null,
  }
}

function parseNumericIdentifier(value, label) {
  if (value.length > 1 && value.startsWith('0')) {
    throw new Error(`Unsupported ${label}: ${value}`)
  }

  const number = Number(value)
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Unsupported ${label}: ${value}`)
  }

  return number
}

export function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`
  if (!version.prerelease) {
    return base
  }

  return `${base}-${version.prerelease.identifier}.${version.prerelease.number}`
}

export function samePrereleaseChannel(left, right) {
  return (
    left.prerelease &&
    right.prerelease &&
    left.major === right.major &&
    left.minor === right.minor &&
    left.patch === right.patch &&
    left.prerelease.identifier === right.prerelease.identifier
  )
}

export function prereleaseNumbersInChannel(versions, channel) {
  const numbers = []

  for (const version of versions) {
    try {
      const parsed = parseVersion(version)
      if (samePrereleaseChannel(parsed, channel)) {
        numbers.push(parsed.prerelease.number)
      }
    } catch {
      // Ignore versions outside this repository's intentionally narrow release format.
    }
  }

  return numbers
}

export async function fetchNpmPackageVersions(packageName) {
  const response = await fetch(`${npmRegistryUrl}/${encodeURIComponent(packageName)}`, {
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

export function packageVersionFromReleaseTag(tag) {
  if (!tag) {
    throw new Error('Release tag is required')
  }

  if (!tag.startsWith('v')) {
    throw new Error(`Release tag must start with v. Got ${tag}.`)
  }

  const version = tag.slice(1)
  try {
    parseVersion(version)
  } catch {
    throw new Error(`Unsupported release tag version: ${version}`)
  }
  return version
}

export function isCliEntrypoint(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href
}

export function writeGithubOutput(values) {
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
