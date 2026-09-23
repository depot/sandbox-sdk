import {timestampDate} from '@bufbuild/protobuf/wkt'
import type {SandboxClient} from './client.js'
import {
  SnapshotStatus as SnapshotStatusProto,
  type Snapshot as SnapshotProto,
} from './gen/depot/sandbox/v1/snapshot_pb.js'
import type {Pagination, PaginationResult, SnapshotStatus} from './types.js'

/**
 * A snapshot of a sandbox's disk, taken with `sandbox.snapshot()`. Boot a new
 * sandbox from it with `runtime: {snapshotId}`.
 */
export class Snapshot {
  readonly snapshotId: string
  readonly organizationId: string
  readonly sourceSandboxId: string
  protected readonly client: SandboxClient

  protected _status: SnapshotStatus | undefined
  protected _name: string | undefined
  protected _imageRef: string | undefined
  protected _sizeBytes: number | undefined
  protected _createdAt: Date | undefined
  protected _expiresAt: Date | undefined
  protected _errorMessage: string | undefined

  protected constructor(opts: {
    client: SandboxClient
    snapshotId: string
    organizationId: string
    sourceSandboxId: string
  }) {
    this.client = opts.client
    this.snapshotId = opts.snapshotId
    this.organizationId = opts.organizationId
    this.sourceSandboxId = opts.sourceSandboxId
  }

  /** Starts `capturing`, then settles as `ready` or `failed`. */
  get status(): SnapshotStatus | undefined {
    return this._status
  }

  /** The label set when the snapshot was taken, if any. */
  get name(): string | undefined {
    return this._name
  }

  /** The digest-pinned OCI image reference of the captured disk. Set once `ready`. */
  get imageRef(): string | undefined {
    return this._imageRef
  }

  /** Size of the captured disk image, in bytes. Set once `ready`. */
  get sizeBytes(): number | undefined {
    return this._sizeBytes
  }

  /** When the snapshot record was created. Always set. */
  get createdAt(): Date | undefined {
    return this._createdAt
  }

  /** After this, new sandboxes can no longer boot from it. Unset when it never expires. */
  get expiresAt(): Date | undefined {
    return this._expiresAt
  }

  /** Why the capture failed. Set only when `failed`. */
  get errorMessage(): string | undefined {
    return this._errorMessage
  }

  /** Fetch a snapshot by its id. */
  static async get(client: SandboxClient, snapshotId: string): Promise<Snapshot> {
    const response = await client.rpc.getSnapshot({selector: {case: 'id', value: snapshotId}})
    if (!response.snapshot) {
      throw new Error('GetSnapshot response missing `snapshot`')
    }
    return Snapshot.fromProto(response.snapshot, client)
  }

  /** Fetch one page of snapshots, newest first. */
  static async list(client: SandboxClient, opts: ListSnapshotsOpts = {}): Promise<ListSnapshotsResult> {
    const sourceSandboxId = opts.filter?.sourceSandboxId
    const response = await client.rpc.listSnapshots({
      pageSize: opts.pagination?.pageSize,
      pageToken: opts.pagination?.pageToken,
      filter:
        sourceSandboxId !== undefined ? {sourceSandbox: {selector: {case: 'id', value: sourceSandboxId}}} : undefined,
    })
    return {
      snapshots: response.snapshots.map((s) => Snapshot.fromProto(s, client)),
      pagination: {nextPageToken: response.nextPageToken || undefined},
    }
  }

  /** Iterate over every snapshot, fetching pages as needed. */
  static async *listAll(client: SandboxClient, opts: ListAllSnapshotsOpts = {}): AsyncIterable<Snapshot> {
    let pageToken: string | undefined = undefined
    while (true) {
      const page: ListSnapshotsResult = await Snapshot.list(client, {
        filter: opts.filter,
        pagination: {pageSize: opts.pageSize, pageToken},
      })
      for (const snapshot of page.snapshots) yield snapshot
      pageToken = page.pagination.nextPageToken
      if (!pageToken) return
    }
  }

  /** @internal Build a Snapshot from the proto returned by the server. */
  protected static fromProto(snapshot: SnapshotProto, client: SandboxClient): Snapshot {
    const instance = new Snapshot({
      client,
      snapshotId: snapshot.snapshotId,
      organizationId: snapshot.organizationId,
      sourceSandboxId: snapshot.sourceSandboxId,
    })
    instance.applyProto(snapshot)
    return instance
  }

  /** Re-read the snapshot from the server and update this instance in place. */
  async refresh(opts: {signal?: AbortSignal} = {}): Promise<void> {
    const response = await this.client.rpc.getSnapshot(
      {selector: {case: 'id', value: this.snapshotId}},
      {signal: opts.signal},
    )
    if (!response.snapshot) {
      throw new Error('GetSnapshot response missing `snapshot`')
    }
    this.applyProto(response.snapshot)
  }

  /**
   * Poll until `ready`, or throw {@link SnapshotFailedError} on `failed`. The
   * server fails a capture still running after about 35 minutes.
   */
  async wait(opts: WaitSnapshotOpts = {}): Promise<void> {
    const pollIntervalMs = opts.pollIntervalMs ?? 2_000
    while (this._status === 'capturing') {
      await sleep(pollIntervalMs, opts.signal)
      await this.refresh({signal: opts.signal})
    }
    if (this._status === 'ready') return
    if (this._status === 'failed') throw new SnapshotFailedError(this)
    throw new Error(`snapshot ${this.snapshotId} has a status this SDK does not recognize`)
  }

  /** Delete the snapshot. Sandboxes booted from it keep running. Rejected while `capturing`. */
  async delete(): Promise<void> {
    await this.client.rpc.deleteSnapshot({snapshot: {selector: {case: 'id', value: this.snapshotId}}})
  }

  /** @internal Refresh this instance's fields from a proto returned by the server. */
  protected applyProto(snapshot: SnapshotProto): void {
    this._status = snapshotStatusFromProto(snapshot.status)
    this._name = snapshot.name
    this._imageRef = snapshot.imageRef
    this._sizeBytes = snapshot.sizeBytes !== undefined ? Number(snapshot.sizeBytes) : undefined
    this._createdAt = snapshot.createdAt ? timestampDate(snapshot.createdAt) : undefined
    this._expiresAt = snapshot.expiresAt ? timestampDate(snapshot.expiresAt) : undefined
    this._errorMessage = snapshot.errorMessage
  }
}

/** Thrown by {@link Snapshot.wait} when the capture ends `failed`. */
export class SnapshotFailedError extends Error {
  override readonly name = 'SnapshotFailedError'
  readonly snapshot: Snapshot
  constructor(snapshot: Snapshot) {
    super(`snapshot ${snapshot.snapshotId} failed: ${snapshot.errorMessage ?? 'no reason given'}`)
    this.snapshot = snapshot
  }
}

/** Options for {@link Snapshot.wait}. */
export interface WaitSnapshotOpts {
  /** How long to wait between polls, in milliseconds. Defaults to 2000. */
  pollIntervalMs?: number
  /** Stop waiting when this signal aborts. The snapshot keeps capturing. */
  signal?: AbortSignal
}

/** Narrows the results of {@link Snapshot.list} and {@link Snapshot.listAll}. */
export interface ListSnapshotsFilter {
  /** Only return snapshots taken from this sandbox. */
  sourceSandboxId?: string
}

/** Options for {@link Snapshot.list}. */
export interface ListSnapshotsOpts {
  pagination?: Pagination
  filter?: ListSnapshotsFilter
}

/** Options for {@link Snapshot.listAll}. */
export interface ListAllSnapshotsOpts {
  pageSize?: number
  filter?: ListSnapshotsFilter
}

/** Result of {@link Snapshot.list}. */
export interface ListSnapshotsResult {
  snapshots: Snapshot[]
  pagination: PaginationResult
}

/** @internal Lets `Sandbox.snapshot` build a Snapshot without widening the public surface. */
export const _snapshotInternals = {
  fromProto(snapshot: SnapshotProto, client: SandboxClient): Snapshot {
    return (Snapshot as unknown as {fromProto(s: SnapshotProto, c: SandboxClient): Snapshot}).fromProto(
      snapshot,
      client,
    )
  },
}

// Same as sandboxStatusFromProto: the SDK strings are the lowercased enum names.
function snapshotStatusFromProto(status: SnapshotStatusProto): SnapshotStatus | undefined {
  if (status === SnapshotStatusProto.UNSPECIFIED) return undefined
  const name = SnapshotStatusProto[status]
  return name === undefined ? undefined : (name.toLowerCase() as SnapshotStatus)
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, {once: true})
  })
}
