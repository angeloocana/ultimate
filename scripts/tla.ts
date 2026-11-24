import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { meansNone } from '../lib/errors.ts'

const TLC = {
  version: '1.7.4',
  url: 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar',
  sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88',
}
const root = join(import.meta.dirname, '..')
const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ultimate')
const jar = join(cache, `tla2tools-${TLC.version}.jar`)

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function tlcJar() {
  const cached = await readFile(jar).catch(meansNone)
  if (cached && sha256(cached) === TLC.sha256) return jar
  if (cached)
    throw new Error(`${jar} does not match TLC ${TLC.version}'s sha256; delete it and run again`)
  console.log(`Downloading TLC ${TLC.version} once into ${cache}`)
  const response = await fetch(TLC.url)
  if (!response.ok) throw new Error(`Downloading ${TLC.url} failed: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== TLC.sha256) throw new Error(`${TLC.url} does not match the pinned sha256`)
  await mkdir(cache, { recursive: true })
  const partial = `${jar}.${process.pid}.partial`
  await writeFile(partial, bytes)
  await rename(partial, jar)
  return jar
}

function java() {
  const candidates = [
    process.env.JAVA,
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin/java'),
    'java',
    ...['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew'].flatMap((prefix) =>
      ['openjdk', 'openjdk@21'].map((formula) => join(prefix, 'opt', formula, 'bin/java')),
    ),
  ].filter((candidate): candidate is string => !!candidate)
  for (const candidate of candidates) {
    if (spawnSync(candidate, ['-version'], { timeout: 30000 }).status === 0) return candidate
  }
  throw new Error(
    'No working Java 11 or later (macOS /usr/bin/java is only a stub): run `brew install openjdk@21`, or set JAVA to a java binary',
  )
}

const models = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : models(path)
    return entry.name.endsWith('.cfg') && folder.endsWith('/test/model') ? [path] : []
  })

function expectation(config: string) {
  const expect = /^\\\* expect: (\S+)/m.exec(readFileSync(config, 'utf8'))?.[1]
  if (!expect)
    throw new Error(`${config}: first line must be "\\* expect: pass" or "\\* expect: <Invariant>"`)
  return expect
}

function spec(config: string) {
  const specs = readdirSync(dirname(config)).filter((name) => name.endsWith('.tla'))
  if (specs.length !== 1) throw new Error(`${dirname(config)} must hold exactly one .tla spec`)
  return specs[0]
}

function outcome(output: string) {
  if (output.includes('Model checking completed. No error has been found.')) return 'pass'
  return /Invariant (\w+) is violated/.exec(output)?.[1] ?? 'error'
}

async function check(javaPath: string, jarPath: string, config: string) {
  const expected = expectation(config)
  const meta = await mkdtemp(join(tmpdir(), 'ultimate-tlc-'))
  try {
    const run = spawnSync(
      javaPath,
      [
        '-XX:+UseParallelGC',
        '-cp',
        jarPath,
        'tlc2.TLC',
        '-workers',
        '1',
        '-metadir',
        meta,
        '-config',
        config,
        spec(config),
      ],
      { cwd: dirname(config), timeout: 120000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
    )
    const output = `${run.stdout}\n${run.stderr}${run.error ? `\n${run.error.message}` : ''}`
    const got = outcome(output)
    const states = /(\d+) distinct states found/.exec(output)?.[1] ?? '?'
    const name = relative(root, config)
    if (got === expected) {
      console.log(
        `✓ ${name}: ${expected === 'pass' ? 'every invariant holds' : `breaks ${expected}, as expected`} (${states} states)`,
      )
      return true
    }
    console.error(`✗ ${name}: expected ${expected}, got ${got}\n${output.trim()}`)
    return false
  } finally {
    await rm(meta, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const configs = existsSync(join(root, 'extensions'))
    ? models(join(root, 'extensions')).toSorted()
    : []
  if (!configs.length) throw new Error('No TLA+ configs found in extensions/*/test/model/')
  const javaPath = java()
  const jarPath = await tlcJar()
  let ok = true
  for (const config of configs) ok = (await check(javaPath, jarPath, config)) && ok
  if (!ok) process.exitCode = 1
}
