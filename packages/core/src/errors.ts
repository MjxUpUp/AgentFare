export class AgentFareError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AgentFareError';
  }
}

export class ConfigError extends AgentFareError {
  constructor(message: string) { super(message, 'CONFIG_ERROR'); }
}

export class RoutingError extends AgentFareError {
  constructor(message: string) { super(message, 'ROUTING_ERROR'); }
}

export class AnalysisError extends AgentFareError {
  constructor(message: string) { super(message, 'ANALYSIS_ERROR'); }
}
