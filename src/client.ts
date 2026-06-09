import {createClient as createConnectClient, type Client} from '@connectrpc/connect'
import {createConnectTransport} from '@connectrpc/connect-node'
import {SandboxService} from './gen/depot/sandbox/v1/sandbox_pb.js'

/** Default Connect endpoint for the v1 sandbox API. */
export const DEFAULT_ENDPOINT = 'https://api.depot.dev'

/**
 * Creates a `SandboxClient`. The returned value is an opaque handle that wraps
 * the underlying Connect client; pass it to static Sandbox entry points.
 *
 * ```ts
 * const client = createClient({token: process.env.DEPOT_TOKEN!})
 * const sandbox = await Sandbox.create(client)
 * ```
 */
export function createClient(opts: CreateClientOpts = {}): SandboxClient {
  const resolved = resolveClientOpts(opts)
  if (!resolved.token) {
    throw new Error('createClient requires a token')
  }
  const endpoint = resolved.endpoint ?? DEFAULT_ENDPOINT
  const transport = createConnectTransport({
    baseUrl: endpoint,
    httpVersion: '2',
    interceptors: [
      (next) => (req) => {
        applyAuthHeaders(req, resolved)
        return next(req)
      },
    ],
  })
  return {
    rpc: createConnectClient(SandboxService, transport),
    endpoint,
  }
}

export interface CreateClientOpts {
  /**
   * Bearer token used to authenticate requests. Defaults to `DEPOT_TOKEN` when
   * omitted.
   */
  token?: string
  /** API endpoint to connect to. Defaults to {@link DEFAULT_ENDPOINT}. */
  endpoint?: string
  /**
   * Organization the client should act on. This is required for app and
   * service tokens, and for user tokens that belong to more than one
   * organization. For a user token bound to a single organization it is
   * ignored, since that organization is already implied. This corresponds to
   * the `--org` flag on the `depot` CLI.
   */
  orgID?: string
}

export interface ResolvedClientOpts extends Omit<CreateClientOpts, 'token'> {
  token: string | undefined
}

/** @internal Resolve explicit options and environment defaults for tests. */
export function resolveClientOpts(opts: CreateClientOpts = {}): ResolvedClientOpts {
  return {
    ...opts,
    token: opts.token ?? process.env.DEPOT_TOKEN,
  }
}

interface HeaderCarrier {
  header: {
    set(name: string, value: string): void
  }
}

/** @internal Apply Depot auth headers for tests and the Connect interceptor. */
export function applyAuthHeaders(req: HeaderCarrier, opts: ResolvedClientOpts): void {
  if (opts.token) {
    req.header.set('Authorization', `Bearer ${opts.token}`)
  }
  // App and service tokens, along with user tokens that belong to more than
  // one organization, need the `x-depot-org` header so the server knows which
  // organization to act on. Without it, those requests are rejected with
  // PermissionDenied. A user token bound to a single organization works with or
  // without the header.
  if (opts.orgID) {
    req.header.set('x-depot-org', opts.orgID)
  }
}

/** Opaque client wrapping a Connect `Client<typeof SandboxService>`. */
export interface SandboxClient {
  readonly rpc: Client<typeof SandboxService>
  readonly endpoint: string
}
