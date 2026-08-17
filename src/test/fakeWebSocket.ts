/**
 * A hand-driven stand-in for the native `WebSocket`, so tests can play an exact
 * engine message sequence with no live connection — which is what the §2
 * required test asks for.
 */

export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  /** Every socket constructed since the last `reset()`, in order. */
  static instances: FakeWebSocket[] = []

  static reset(): void {
    FakeWebSocket.instances = []
  }

  /** The most recently constructed socket. */
  static get last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1)
    if (!socket) throw new Error('No FakeWebSocket has been constructed yet.')
    return socket
  }

  readonly url: string
  readyState: number = FakeWebSocket.CONNECTING

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  /** Simulate the server accepting the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  /** Deliver one frame, serialized exactly as the engine would send it. */
  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }

  /** Deliver a raw (possibly malformed) frame. */
  emitRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  /** Simulate the connection dropping from the server side. */
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  /** The client closing — what the hook's cleanup calls. */
  close(): void {
    this.readyState = FakeWebSocket.CLOSED
  }
}

/** Installs `FakeWebSocket` as the global `WebSocket`. Pair with `vi.unstubAllGlobals()`. */
export function installFakeWebSocket(stubGlobal: (name: string, value: unknown) => void) {
  FakeWebSocket.reset()
  stubGlobal('WebSocket', FakeWebSocket)
}
