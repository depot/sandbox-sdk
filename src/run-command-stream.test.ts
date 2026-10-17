import {timestampFromDate} from '@bufbuild/protobuf/wkt'
import type {ConnectRouter} from '@connectrpc/connect'
import {connectNodeAdapter} from '@connectrpc/connect-node'
import assert from 'node:assert'
import {spawn} from 'node:child_process'
import http2 from 'node:http2'
import type {AddressInfo} from 'node:net'
import test from 'node:test'
import {setTimeout as sleep} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'
import {createClient} from './client.js'
import {SandboxService, SandboxStatus} from './gen/depot/sandbox/v1/sandbox_pb.js'
import {Sandbox} from './sandbox.js'

const CHILD_ENDPOINT = process.env.RUN_COMMAND_STREAM_TEST_ENDPOINT

// Child mode: run one command against the parent's server, then fall off the
// end. The parent asserts this process exits on its own.
if (CHILD_ENDPOINT) {
  const sandbox = await Sandbox.create(createClient({token: 'test', endpoint: CHILD_ENDPOINT}))
  const detached = process.env.RUN_COMMAND_STREAM_TEST_DETACHED === '1'
  const command = await sandbox.runCommand({cmd: '/bin/true', detached})
  if (!detached) assert.equal((await command.wait()).exitCode, 0)
} else {
  // The server ends RunCommand the way the API does, but its end-of-stream
  // frame lands after the last event, so the SDK must keep reading to free it.
  async function withServer(fn: (endpoint: string) => Promise<void>): Promise<void> {
    const routes = (router: ConnectRouter) =>
      router.service(SandboxService, {
        createSandbox: () => ({
          sandbox: {sandboxId: 'sbx_1', status: SandboxStatus.RUNNING, createdAt: timestampFromDate(new Date())},
        }),
        async *runCommand(req) {
          yield {event: {case: 'started', value: {cmdId: 'cmd_1', startedAt: timestampFromDate(new Date())}}}
          if (!req.detached)
            yield {event: {case: 'finished', value: {exitCode: 0, finishedAt: timestampFromDate(new Date())}}}
          await sleep(100)
        },
      })
    const server = http2.createServer(connectNodeAdapter({routes}))
    const sessions = new Set<http2.ServerHttp2Session>()
    server.on('session', (session) => sessions.add(session))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    } finally {
      for (const session of sessions) session.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  }

  async function childExitCode(endpoint: string, detached: boolean): Promise<number | null> {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        RUN_COMMAND_STREAM_TEST_ENDPOINT: endpoint,
        RUN_COMMAND_STREAM_TEST_DETACHED: detached ? '1' : '0',
      },
      stdio: 'inherit',
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try {
      return await new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
    } finally {
      clearTimeout(timer)
    }
  }

  test('node exits after runCommand + wait() once the stream ends', async () => {
    await withServer(async (endpoint) =>
      assert.equal(await childExitCode(endpoint, false), 0, 'child exited on its own'),
    )
  })

  test('node exits after a detached runCommand once the stream ends', async () => {
    await withServer(async (endpoint) =>
      assert.equal(await childExitCode(endpoint, true), 0, 'child exited on its own'),
    )
  })
}
