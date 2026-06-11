import {readFileSync, writeFileSync} from 'node:fs'
import {
  fetchNpmPackageVersions,
  formatVersion,
  isCliEntrypoint,
  packageVersionFromReleaseTag,
  parseVersion,
  prereleaseNumbersInChannel,
  samePrereleaseChannel,
  writeGithubOutput,
} from './release-version-utils.mjs'

export {packageVersionFromReleaseTag} from './release-version-utils.mjs'

export function setPackageVersionFromReleaseTag({tag, packageJsonPath = 'package.json', publishedVersions = []}) {
  const version = packageVersionFromReleaseTag(tag)
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  assertReleaseVersionAllowed({releaseVersion: version, packageVersion: pkg.version, publishedVersions})
  pkg.version = version

  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return version
}

export function assertReleaseVersionAllowed({releaseVersion, packageVersion, publishedVersions = []}) {
  const release = parseVersion(releaseVersion)
  const pkg = parseVersion(packageVersion)

  rejectPublishedPrereleaseRegression({release, releaseVersion, publishedVersions})

  if (formatVersion(release) === formatVersion(pkg)) {
    return
  }

  if (!release.prerelease || !pkg.prerelease) {
    throw new Error(
      `Release version ${releaseVersion} must match package.json version ${packageVersion}; stable releases do not auto-advance.`,
    )
  }

  if (!samePrereleaseChannel(release, pkg) || release.prerelease.number < pkg.prerelease.number) {
    throw new Error(
      `Release version ${releaseVersion} is not an allowed advancement from package.json version ${packageVersion}.`,
    )
  }
}

function rejectPublishedPrereleaseRegression({release, releaseVersion, publishedVersions}) {
  if (!release.prerelease) {
    return
  }

  const publishedMax = Math.max(0, ...prereleaseNumbersInChannel(publishedVersions, release))
  if (publishedMax >= release.prerelease.number) {
    throw new Error(
      `Release version ${releaseVersion} is not newer than the latest published prerelease in this channel (${publishedMax}).`,
    )
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
  return {packageName: pkg.name}
}

async function main() {
  const tag = process.env.RELEASE_TAG ?? process.argv[2]
  const packageJsonPath = process.env.PACKAGE_JSON_PATH ?? 'package.json'
  const {packageName} = readPackageMetadata(packageJsonPath)
  const publishedVersions = await fetchNpmPackageVersions(packageName)
  const version = setPackageVersionFromReleaseTag({tag, packageJsonPath, publishedVersions})
  writeGithubOutput({version})
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
