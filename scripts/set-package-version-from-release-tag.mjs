import {appendFileSync, readFileSync, writeFileSync} from 'node:fs'
import {formatVersion, isCliEntrypoint, packageVersionFromReleaseTag, parseVersion} from './release-version-utils.mjs'

export {packageVersionFromReleaseTag} from './release-version-utils.mjs'

export function setPackageVersionFromReleaseTag({tag, packageJsonPath = 'package.json'}) {
  const version = packageVersionFromReleaseTag(tag)
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  assertReleaseVersionAllowed({releaseVersion: version, packageVersion: pkg.version})
  pkg.version = version

  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return version
}

export function assertReleaseVersionAllowed({releaseVersion, packageVersion}) {
  const release = parseVersion(releaseVersion)
  const pkg = parseVersion(packageVersion)

  if (formatVersion(release) === formatVersion(pkg)) {
    return
  }

  if (!release.prerelease || !pkg.prerelease) {
    throw new Error(
      `Release version ${releaseVersion} must match package.json version ${packageVersion}; stable releases do not auto-advance.`,
    )
  }

  const samePrereleaseChannel =
    release.major === pkg.major &&
    release.minor === pkg.minor &&
    release.patch === pkg.patch &&
    release.prerelease.identifier === pkg.prerelease.identifier

  if (!samePrereleaseChannel || release.prerelease.number < pkg.prerelease.number) {
    throw new Error(
      `Release version ${releaseVersion} is not an allowed advancement from package.json version ${packageVersion}.`,
    )
  }
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

function main() {
  const tag = process.env.RELEASE_TAG ?? process.argv[2]
  const version = setPackageVersionFromReleaseTag({tag})
  writeGithubOutput({version})
}

if (isCliEntrypoint(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
