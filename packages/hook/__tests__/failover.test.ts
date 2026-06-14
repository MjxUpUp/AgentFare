import { describe, it, expect } from "vitest";
import {
  CircuitBreaker,
  shouldFailover,
  hostOf,
  DEFAULT_CIRCUIT_CONFIG,
} from "../src/failover.js";

describe("shouldFailover", () => {
  it("triggers on 5xx server errors", () => {
    expect(shouldFailover(500, undefined)).toBe(true);
    expect(shouldFailover(502, undefined)).toBe(true);
    expect(shouldFailover(503, undefined)).toBe(true);
  });

  it("triggers on 429 rate limit", () => {
    expect(shouldFailover(429, undefined)).toBe(true);
  });

  it("triggers on 408 timeout", () => {
    expect(shouldFailover(408, undefined)).toBe(true);
  });

  it("triggers on any thrown error regardless of status", () => {
    expect(shouldFailover(undefined, new Error("net"))).toBe(true);
    expect(shouldFailover(200, new Error("net"))).toBe(true); // error dominates a 2xx status
    expect(shouldFailover(undefined, "string error")).toBe(true);
  });

  it("triggers when status is undefined and there is no error", () => {
    expect(shouldFailover(undefined, undefined)).toBe(true);
  });

  it("does NOT trigger on 2xx/3xx/4xx (non-5xx, non-429, non-408)", () => {
    expect(shouldFailover(200, undefined)).toBe(false);
    expect(shouldFailover(204, undefined)).toBe(false);
    expect(shouldFailover(301, undefined)).toBe(false);
    expect(shouldFailover(400, undefined)).toBe(false); // client error — caller's fault, not upstream
    expect(shouldFailover(401, undefined)).toBe(false);
    expect(shouldFailover(404, undefined)).toBe(false);
    expect(shouldFailover(422, undefined)).toBe(false);
  });

  it("treats null error as no error", () => {
    expect(shouldFailover(200, null)).toBe(false);
  });
});

describe("hostOf", () => {
  it("extracts host:port from a URL", () => {
    expect(hostOf("https://api.openai.com/v1/chat/completions")).toBe("api.openai.com");
    expect(hostOf("http://localhost:8080/path")).toBe("localhost:8080");
  });

  it("returns the raw string when the URL is invalid", () => {
    expect(hostOf("not-a-url")).toBe("not-a-url");
    expect(hostOf("")).toBe("");
  });
});

describe("CircuitBreaker", () => {
  it("starts closed and allows requests for an unknown host", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState("a.example")).toBe("closed");
    expect(cb.allowRequest("a.example")).toBe(true);
    expect(cb.trippedCount).toBe(0);
  });

  it("opens after failureThreshold consecutive failures (default config)", () => {
    const cb = new CircuitBreaker();
    const host = "h.example";
    const { failureThreshold } = DEFAULT_CIRCUIT_CONFIG;
    for (let i = 0; i < failureThreshold - 1; i++) {
      cb.recordFailure(host);
      expect(cb.getState(host)).toBe("closed"); // not yet
    }
    cb.recordFailure(host); // the threshold-th failure
    expect(cb.getState(host)).toBe("open");
    expect(cb.allowRequest(host)).toBe(false);
    expect(cb.trippedCount).toBe(1);
  });

  it("resets the failure counter on a success while closed", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, halfOpenMax: 1 });
    cb.recordFailure("h"); // 1
    cb.recordFailure("h"); // 2
    cb.recordSuccess("h"); // resets
    cb.recordFailure("h"); // 1 again, not 3
    expect(cb.getState("h")).toBe("closed");
    cb.recordFailure("h"); // 2
    cb.recordFailure("h"); // 3 → open
    expect(cb.getState("h")).toBe("open");
  });

  it("moves open → halfOpen after cooldown and allows a single probe", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, halfOpenMax: 1 });
    const host = "h.example";
    cb.recordFailure(host, 0); // open at t=0
    expect(cb.getState(host)).toBe("open");
    expect(cb.allowRequest(host, 500)).toBe(false); // cooldown not elapsed

    const after = 1000;
    expect(cb.allowRequest(host, after)).toBe(true); // cooldown elapsed → halfOpen probe
    expect(cb.getState(host)).toBe("halfOpen");
    // onAttempt books the single allowed probe
    cb.onAttempt(host);
    expect(cb.allowRequest(host, after)).toBe(false); // halfOpenMax reached
  });

  it("closes the circuit on a half-open success", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, halfOpenMax: 1 });
    const host = "h.example";
    cb.recordFailure(host, 0); // open
    cb.allowRequest(host, 1000); // → halfOpen
    cb.onAttempt(host);
    cb.recordSuccess(host);
    expect(cb.getState(host)).toBe("closed");
    expect(cb.allowRequest(host, 1000)).toBe(true); // fully closed again
  });

  it("reopens immediately on a half-open failure with a fresh cooldown", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, halfOpenMax: 1 });
    const host = "h.example";
    cb.recordFailure(host, 0); // open at 0
    cb.allowRequest(host, 1000); // → halfOpen
    cb.onAttempt(host);
    cb.recordFailure(host, 2000); // probe failed → reopen at t=2000
    expect(cb.getState(host)).toBe("open");
    expect(cb.allowRequest(host, 2500)).toBe(false); // new cooldown (2000+1000) not elapsed
    expect(cb.allowRequest(host, 3000)).toBe(true); // elapsed
  });

  it("recordSuccess on an unknown host is a no-op", () => {
    const cb = new CircuitBreaker();
    expect(() => cb.recordSuccess("never-seen")).not.toThrow();
    expect(cb.getState("never-seen")).toBe("closed");
  });

  it("onAttempt only books against a half-open circuit", () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 1000, halfOpenMax: 1 });
    cb.onAttempt("h"); // closed — no-op, must not throw or create state
    expect(cb.getState("h")).toBe("closed");
  });

  it("trippedCount reflects all non-closed hosts", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000, halfOpenMax: 1 });
    cb.recordFailure("a");
    cb.recordFailure("b");
    expect(cb.trippedCount).toBe(2);
    cb.recordFailure("c");
    expect(cb.trippedCount).toBe(3);
  });

  it("reset clears all circuits", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000, halfOpenMax: 1 });
    cb.recordFailure("a");
    cb.recordFailure("b");
    expect(cb.trippedCount).toBe(2);
    cb.reset();
    expect(cb.trippedCount).toBe(0);
    expect(cb.getState("a")).toBe("closed");
    expect(cb.allowRequest("a")).toBe(true);
  });

  it("isolates circuits per host", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000, halfOpenMax: 1 });
    cb.recordFailure("bad.example");
    expect(cb.getState("bad.example")).toBe("open");
    expect(cb.allowRequest("bad.example")).toBe(false);
    expect(cb.getState("good.example")).toBe("closed");
    expect(cb.allowRequest("good.example")).toBe(true);
  });
});
