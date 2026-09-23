import {create, type MessageInitShape} from '@bufbuild/protobuf'
import {timestampFromDate} from '@bufbuild/protobuf/wkt'
import assert from 'node:assert'
import test from 'node:test'
import type {SandboxClient} from './client.js'
import {
  DeleteSnapshotResponseSchema,
  GetSnapshotResponseSchema,
  ListSnapshotsResponseSchema,
  SnapshotSchema,
  SnapshotStatus as SnapshotStatusProto,
  type Snapshot as SnapshotProto,
} from './gen/depot/sandbox/v1/snapshot_pb.js'
import {Snapshot, SnapshotFailedError} from './snapshot.js'

const CREATED_AT = new Date('2026-06-08T12:00:00.000Z')
const EXPIRES_AT = new Date('2026-06-09T12:00:00.000Z')

function fakeClient(overrides: Partial<Record<string, (req: unknown) => unknown>>): {
  client: SandboxClient
  calls: (name: string) => unknown[]
} {
  const requests = new Map<string, unknown[]>()
  const rpc = new Proxy(
    {},
    {
      get(_target, name: string) {
        const fn = overrides[name]
        if (!fn) throw new Error(`unexpected RPC call: ${name}`)
        return (req: unknown) => {
          requests.set(name, [...(requests.get(name) ?? []), req])
          return fn(req)
        }
      },
    },
  )
  return {
    client: {rpc, endpoint: 'http://test'} as unknown as SandboxClient,
    calls: (name: string) => requests.get(name) ?? [],
  }
}

function makeSnapshot(overrides: MessageInitShape<typeof SnapshotSchema> = {}): SnapshotProto {
  return create(SnapshotSchema, {
    snapshotId: 'snap_1',
    organizationId: 'org_1',
    sourceSandboxId: 'sbx_1',
    status: SnapshotStatusProto.READY,
    imageRef: 'registry.example/snapshots@sha256:abc',
    sizeBytes: 1024n,
    createdAt: timestampFromDate(CREATED_AT),
    ...overrides,
  })
}

// Replies to GetSnapshot with each status in turn, holding the last one.
function getSnapshotSequence(...statuses: SnapshotStatusProto[]): () => unknown {
  let i = 0
  return () => {
    const status = statuses[Math.min(i++, statuses.length - 1)]
    return create(GetSnapshotResponseSchema, {
      snapshot: makeSnapshot(
        status === SnapshotStatusProto.READY
          ? {status}
          : {
              status,
              imageRef: undefined,
              sizeBytes: undefined,
              errorMessage: status === SnapshotStatusProto.FAILED ? 'push failed' : undefined,
            },
      ),
    })
  }
}

test('Snapshot.get maps every field to its SDK shape', async () => {
  const recording = fakeClient({
    getSnapshot: () =>
      create(GetSnapshotResponseSchema, {
        snapshot: makeSnapshot({name: 'deps', expiresAt: timestampFromDate(EXPIRES_AT)}),
      }),
  })

  const snapshot = await Snapshot.get(recording.client, 'snap_1')

  assert.deepEqual(recording.calls('getSnapshot'), [{selector: {case: 'id', value: 'snap_1'}}])
  assert.equal(snapshot.snapshotId, 'snap_1')
  assert.equal(snapshot.organizationId, 'org_1')
  assert.equal(snapshot.sourceSandboxId, 'sbx_1')
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.name, 'deps')
  assert.equal(snapshot.imageRef, 'registry.example/snapshots@sha256:abc')
  assert.equal(snapshot.sizeBytes, 1024)
  assert.deepEqual(snapshot.createdAt, CREATED_AT)
  assert.deepEqual(snapshot.expiresAt, EXPIRES_AT)
  assert.equal(snapshot.errorMessage, undefined)
})

test('Snapshot.get reads an unknown status as undefined', async () => {
  const recording = fakeClient({
    getSnapshot: () => create(GetSnapshotResponseSchema, {snapshot: makeSnapshot({status: 99 as SnapshotStatusProto})}),
  })

  const snapshot = await Snapshot.get(recording.client, 'snap_1')
  assert.equal(snapshot.status, undefined)
})

test('Snapshot.list sends the source-sandbox filter and pagination', async () => {
  const recording = fakeClient({
    listSnapshots: () =>
      create(ListSnapshotsResponseSchema, {
        snapshots: [makeSnapshot({snapshotId: 'snap_2'}), makeSnapshot({snapshotId: 'snap_1'})],
        nextPageToken: 'next',
      }),
  })

  const page = await Snapshot.list(recording.client, {
    pagination: {pageSize: 2, pageToken: 'tok'},
    filter: {sourceSandboxId: 'sbx_1'},
  })

  assert.deepEqual(recording.calls('listSnapshots'), [
    {pageSize: 2, pageToken: 'tok', filter: {sourceSandbox: {selector: {case: 'id', value: 'sbx_1'}}}},
  ])
  assert.deepEqual(
    page.snapshots.map((s) => s.snapshotId),
    ['snap_2', 'snap_1'],
  )
  assert.equal(page.pagination.nextPageToken, 'next')
})

test('Snapshot.list omits the filter when none is given', async () => {
  const recording = fakeClient({
    listSnapshots: () => create(ListSnapshotsResponseSchema, {snapshots: []}),
  })

  const page = await Snapshot.list(recording.client)

  assert.deepEqual(recording.calls('listSnapshots'), [{pageSize: undefined, pageToken: undefined, filter: undefined}])
  assert.equal(page.pagination.nextPageToken, undefined)
})

test('Snapshot.listAll follows page tokens until the last page', async () => {
  const pages = [
    create(ListSnapshotsResponseSchema, {snapshots: [makeSnapshot({snapshotId: 'snap_1'})], nextPageToken: 'p2'}),
    create(ListSnapshotsResponseSchema, {snapshots: [makeSnapshot({snapshotId: 'snap_2'})]}),
  ]
  let i = 0
  const recording = fakeClient({listSnapshots: () => pages[i++]})

  const ids: string[] = []
  for await (const snapshot of Snapshot.listAll(recording.client, {pageSize: 1})) ids.push(snapshot.snapshotId)

  assert.deepEqual(ids, ['snap_1', 'snap_2'])
  assert.deepEqual(
    recording.calls('listSnapshots').map((r) => (r as {pageToken?: string}).pageToken),
    [undefined, 'p2'],
  )
})

test('snapshot.wait polls until ready', async () => {
  const recording = fakeClient({
    getSnapshot: getSnapshotSequence(
      SnapshotStatusProto.CAPTURING,
      SnapshotStatusProto.CAPTURING,
      SnapshotStatusProto.READY,
    ),
  })
  const snapshot = await Snapshot.get(recording.client, 'snap_1')
  assert.equal(snapshot.status, 'capturing')

  await snapshot.wait({pollIntervalMs: 0})

  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.imageRef, 'registry.example/snapshots@sha256:abc')
  assert.equal(recording.calls('getSnapshot').length, 3)
})

test('snapshot.wait throws SnapshotFailedError carrying the server reason', async () => {
  const recording = fakeClient({
    getSnapshot: getSnapshotSequence(SnapshotStatusProto.CAPTURING, SnapshotStatusProto.FAILED),
  })
  const snapshot = await Snapshot.get(recording.client, 'snap_1')

  await assert.rejects(snapshot.wait({pollIntervalMs: 0}), (err: unknown) => {
    assert.ok(err instanceof SnapshotFailedError)
    assert.equal(err.snapshot, snapshot)
    assert.match(err.message, /push failed/)
    return true
  })
  assert.equal(snapshot.status, 'failed')
})

test('snapshot.wait returns at once for a snapshot that is already ready', async () => {
  const recording = fakeClient({getSnapshot: getSnapshotSequence(SnapshotStatusProto.READY)})
  const snapshot = await Snapshot.get(recording.client, 'snap_1')

  await snapshot.wait()

  assert.equal(recording.calls('getSnapshot').length, 1)
})

test('snapshot.wait stops when its signal aborts', async () => {
  const recording = fakeClient({getSnapshot: getSnapshotSequence(SnapshotStatusProto.CAPTURING)})
  const snapshot = await Snapshot.get(recording.client, 'snap_1')
  const controller = new AbortController()

  const waiting = snapshot.wait({pollIntervalMs: 60_000, signal: controller.signal})
  controller.abort(new Error('gave up'))

  await assert.rejects(waiting, /gave up/)
  assert.equal(recording.calls('getSnapshot').length, 1)
})

test('snapshot.delete sends the snapshot ref', async () => {
  const recording = fakeClient({
    getSnapshot: getSnapshotSequence(SnapshotStatusProto.READY),
    deleteSnapshot: () => create(DeleteSnapshotResponseSchema, {}),
  })
  const snapshot = await Snapshot.get(recording.client, 'snap_1')

  await snapshot.delete()

  assert.deepEqual(recording.calls('deleteSnapshot'), [{snapshot: {selector: {case: 'id', value: 'snap_1'}}}])
})
