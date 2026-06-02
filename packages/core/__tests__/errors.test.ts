import { describe, it, expect } from "vitest";
import {
  AgentFareError,
  ConfigError,
  RoutingError,
  AnalysisError,
} from "../src/errors.js";

describe("AgentFareError", () => {
  it("stores message and code", () => {
    const err = new AgentFareError("something broke", "TEST_CODE");
    expect(err.message).toBe("something broke");
    expect(err.code).toBe("TEST_CODE");
  });

  it("has correct name", () => {
    const err = new AgentFareError("msg", "CODE");
    expect(err.name).toBe("AgentFareError");
  });

  it("is instanceof Error", () => {
    const err = new AgentFareError("msg", "CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentFareError);
  });
});

describe("ConfigError", () => {
  it("has code CONFIG_ERROR", () => {
    const err = new ConfigError("bad config");
    expect(err.code).toBe("CONFIG_ERROR");
  });

  it("passes message through", () => {
    const err = new ConfigError("missing field");
    expect(err.message).toBe("missing field");
  });

  it("is instanceof AgentFareError and Error", () => {
    const err = new ConfigError("msg");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentFareError);
    expect(err).toBeInstanceOf(ConfigError);
  });
});

describe("RoutingError", () => {
  it("has code ROUTING_ERROR", () => {
    const err = new RoutingError("no route");
    expect(err.code).toBe("ROUTING_ERROR");
  });

  it("passes message through", () => {
    const err = new RoutingError("circular dependency");
    expect(err.message).toBe("circular dependency");
  });

  it("is instanceof AgentFareError and Error", () => {
    const err = new RoutingError("msg");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentFareError);
    expect(err).toBeInstanceOf(RoutingError);
  });
});

describe("AnalysisError", () => {
  it("has code ANALYSIS_ERROR", () => {
    const err = new AnalysisError("parse fail");
    expect(err.code).toBe("ANALYSIS_ERROR");
  });

  it("passes message through", () => {
    const err = new AnalysisError("model unavailable");
    expect(err.message).toBe("model unavailable");
  });

  it("is instanceof AgentFareError and Error", () => {
    const err = new AnalysisError("msg");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentFareError);
    expect(err).toBeInstanceOf(AnalysisError);
  });
});

describe("instanceof chain across subclasses", () => {
  it("ConfigError is not instanceof RoutingError", () => {
    const err = new ConfigError("test");
    expect(err).toBeInstanceOf(ConfigError);
    expect(err).not.toBeInstanceOf(RoutingError);
  });

  it("RoutingError is not instanceof AnalysisError", () => {
    const err = new RoutingError("test");
    expect(err).toBeInstanceOf(RoutingError);
    expect(err).not.toBeInstanceOf(AnalysisError);
  });

  it("AnalysisError is not instanceof ConfigError", () => {
    const err = new AnalysisError("test");
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err).not.toBeInstanceOf(ConfigError);
  });
});
