/**
 * Failover policy + circuit breaker.
 *
 * Shared by the two transport twins (packages/proxy/src/server.ts node:http and
 * packages/hook/src/fetch-patch.ts globalThis.fetch).
 *
 * ISSUE: the previous fallback only triggered on HTTP >= 500 and did a single
 * retry of the original request. 429 (rate limit) / 408 (timeout) / network
 * errors / aborts were NOT covered, and there was no circuit breaker — a
 * downed upstream kept getting hammered on every request. shouldFailover()
 * broadens the trigger; CircuitBreaker short-circuits a repeatedly-failing host.
 */

export interface CircuitBreakerConfig {
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** Time in the open state before a half-open probe is allowed (ms). */
  cooldownMs: number;
  /** Probe requests permitted concurrently while half-open. */
  halfOpenMax: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  halfOpenMax: 1,
};

export type CircuitState = "closed" | "open" | "halfOpen";

interface HostCircuit {
  state: CircuitState;
  failures: number;
  openedAt: number;
  halfOpenInflight: number;
}

/**
 * Per-host circuit breaker.
 *
 * closed → (failureThreshold consecutive failures) → open
 * open → (cooldownMs elapsed) → halfOpen (limited probes)
 * halfOpen → success → closed | failure → open
 */
export class CircuitBreaker {
  private hosts = new Map<string, HostCircuit>();

  constructor(private config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG) {}

  /** True if a request to `host` may proceed (not currently tripped). */
  allowRequest(host: string, now: number = Date.now()): boolean {
    const c = this.hosts.get(host);
    if (!c) return true;
    if (c.state === "open") {
      if (now - c.openedAt >= this.config.cooldownMs) {
        c.state = "halfOpen";
        c.halfOpenInflight = 0;
        return true; // allow a probe
      }
      return false;
    }
    if (c.state === "halfOpen") {
      return c.halfOpenInflight < this.config.halfOpenMax;
    }
    return true; // closed
  }

  /** Track that an allowed request to `host` has started (for half-open accounting). */
  onAttempt(host: string): void {
    const c = this.hosts.get(host);
    if (c && c.state === "halfOpen") c.halfOpenInflight += 1;
  }

  /** A request succeeded — close the circuit and reset counters. */
  recordSuccess(host: string): void {
    const c = this.hosts.get(host);
    if (!c) return;
    c.state = "closed";
    c.failures = 0;
    c.halfOpenInflight = 0;
  }

  /** A request failed — increment failures, possibly open the circuit. */
  recordFailure(host: string, now: number = Date.now()): void {
    let c = this.hosts.get(host);
    if (!c) {
      c = { state: "closed", failures: 0, openedAt: 0, halfOpenInflight: 0 };
      this.hosts.set(host, c);
    }
    if (c.state === "halfOpen") {
      // a probe failed — reopen immediately
      c.state = "open";
      c.openedAt = now;
      c.halfOpenInflight = 0;
      return;
    }
    c.failures += 1;
    if (c.failures >= this.config.failureThreshold) {
      c.state = "open";
      c.openedAt = now;
    }
  }

  /** Current state for a host (closed if unknown). */
  getState(host: string): CircuitState {
    return this.hosts.get(host)?.state ?? "closed";
  }

  /** Number of hosts currently in a non-closed state (for observability/tests). */
  get trippedCount(): number {
    let n = 0;
    for (const c of this.hosts.values()) {
      if (c.state !== "closed") n += 1;
    }
    return n;
  }

  /** Reset all circuits (testing / manual reset). */
  reset(): void {
    this.hosts.clear();
  }
}

/**
 * Decide whether a response status or thrown error should trigger failover.
 *
 * Covers:
 *  - 5xx server errors
 *  - 429 rate limiting
 *  - 408 request timeout
 *  - any thrown error (network failure, abort, DNS, connect timeout)
 */
export function shouldFailover(status: number | undefined, error: unknown): boolean {
  if (error !== undefined && error !== null) return true;
  if (status === undefined) return true;
  return status >= 500 || status === 429 || status === 408;
}

/** Extract the host (host:port) of a URL for circuit-breaker keying. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
