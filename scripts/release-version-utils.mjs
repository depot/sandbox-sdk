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
