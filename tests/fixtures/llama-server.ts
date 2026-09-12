import Fastify from "fastify";

export interface FakeLlama {
  url: string;
  received: {path: string; body: unknown}[];
  setTokenCount(n: number): void;
  setCompletion(value: Partial<{content: string; stop_type: "eos" | "word" | "limit"; tokens_evaluated: number; tokens_predicted: number; truncated: boolean}>): void;
  requireApiKey(key: string): void;
  close(): Promise<void>;
}

export async function startFakeLlama(): Promise<FakeLlama> {
  const app = Fastify();
  const received: {path: string; body: unknown}[] = [];
  let tokenCount = 12;
  let completion = {content: "ANSWER: B", stop_type: "eos" as const, tokens_evaluated: 12, tokens_predicted: 4, truncated: false};
  let apiKey: string | null = null;
  app.addHook("onRequest", async (request, reply) => {
    if (apiKey && request.headers.authorization !== `Bearer ${apiKey}`) return reply.code(401).send({error: "unauthorized"});
  });
  app.get("/health", async () => ({status: "ok"}));
  app.get("/props", async () => ({build_info: "fixture-engine", chat_template: "fixture-template", total_slots: 1, default_generation_settings: {n_ctx: 2048}}));
  app.post("/apply-template", async request => {
    received.push({path: "/apply-template", body: request.body});
    return {prompt: "<fixture>templated</fixture>"};
  });
  app.post("/tokenize", async request => {
    received.push({path: "/tokenize", body: request.body});
    return {tokens: Array.from({length: tokenCount}, (_, i) => i + 10)};
  });
  app.post("/completion", async request => {
    received.push({path: "/completion", body: request.body});
    return {...completion, index: 0, tokens: [], id_slot: 0, stop: true, model: "fixture", generation_settings: {}, prompt: "", has_new_line: false, stopping_word: "", tokens_cached: 0, timings: {}};
  });
  await app.listen({host: "127.0.0.1", port: 0});
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    setTokenCount(n) { tokenCount = n; completion = {...completion, tokens_evaluated: n}; },
    setCompletion(value) { completion = {...completion, ...value} as typeof completion; },
    requireApiKey(key) { apiKey = key; },
    async close() { await app.close(); },
  };
}
