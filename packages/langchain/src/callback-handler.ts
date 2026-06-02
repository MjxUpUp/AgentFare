const WARNING_MSG = "[AgentFare] LangChain callback handler is not yet functional — all methods are no-ops";

export class AgentFareCallbackHandler {
  name = "agentfare-callback";
  private _warned = false;

  private _warn(): void {
    if (!this._warned) {
      console.warn(WARNING_MSG);
      this._warned = true;
    }
  }

  async handleLLMStart(_llm: unknown, _prompts: string[]): Promise<void> {
    this._warn();
  }

  async handleLLMEnd(_output: unknown): Promise<void> {
    this._warn();
  }

  async handleLLMError(_err: unknown): Promise<void> {
    this._warn();
  }

  async handleToolStart(_tool: unknown, _input: unknown): Promise<void> {
    this._warn();
  }

  async handleToolEnd(_output: unknown): Promise<void> {
    this._warn();
  }
}
