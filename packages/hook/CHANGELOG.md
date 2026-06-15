# @agentfare/hook

## 0.2.0

### Minor Changes

- [`41c0256`](https://github.com/MjxUpUp/AgentFare/commit/41c02563fceecfa7df249e5b211cd02d2f550230) Thanks [@MjxUpUp](https://github.com/MjxUpUp)! - cc-switch-inspired improvements + review fixes:

  - Reversible takeover: `agentfare restore` reverses proxy BASE_URL takeover
  - Failover: per-host circuit breaker + broadened triggers (5xx/429/408/network)
  - Credential SSOT: atomic write, 0o600 permissions, mtime+size cache invalidation
  - Paths SSOT: all data/config paths route through getBaseDir()
  - Ban guard: relay/official host binding validation prevents cross-provider ban risk
  - Review fixes S1-S5 (transport fallback correctness, shell restore data preservation) and M1-M7 (RoutingDecision observability, credential cache resilience, install-script SSOT)

### Patch Changes

- Updated dependencies [[`41c0256`](https://github.com/MjxUpUp/AgentFare/commit/41c02563fceecfa7df249e5b211cd02d2f550230)]:
  - @agentfare/models@0.2.0
  - @agentfare/core@0.2.0
