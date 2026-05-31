const LLM_URL_PATTERNS = [
  /api\.openai\.com\/v1\/chat\/completions/,
  /api\.anthropic\.com\/v1\/messages/,
  /api\.deepseek\.com\/.*chat\/completions/,
  /open\.bigmodel\.cn\/api\/paas\/v4\/chat\/completions/,
  /api\.moonshot\.cn\/v1\/chat\/completions/,
  /dashscope\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions/,
  /platform\.xiaomimimo\.com\/v1\/chat\/completions/,
  /generativelanguage\.googleapis\.com\/.*\/chat\/completions/,
];

export function isLLMApiCall(url: string): boolean {
  return LLM_URL_PATTERNS.some((p) => p.test(url));
}
