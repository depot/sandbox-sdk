import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'

const generatedDir = 'src/gen'

function snapshot(dir) {
  const files = new Map()
  for (const file of walk(dir)) {
    const contents = readFileSync(file)
    files.set(file, createHash('sha256').update(contents).digest('hex'))
  }
  return files
}

function walk(dir) {
  const entries = readdirSync(dir).sort()
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...walk(path))
    } else if (stat.isFile()) {
      files.push(path)
    }
  }
  return files
}

function diffSnapshots(before, after) {
  const changed = []
  const paths = new Set([...before.keys(), ...after.keys()])
  for (const path of [...paths].sort()) {
    if (before.get(path) !== after.get(path)) {
      changed.push(relative(process.cwd(), path))
    }
  }
  return changed
}

const before = snapshot(generatedDir)

execFileSync('buf', ['generate'], {stdio: 'inherit'})
execFileSync('prettier', ['--write', generatedDir], {stdio: 'inherit'})

const changed = diffSnapshots(before, snapshot(generatedDir))
if (changed.length > 0) {
  console.error('Generated files are out of date. Run `pnpm run gen` and commit the result.')
  for (const file of changed) {
    console.error(`- ${file}`)
  }
  process.exit(1)
}
