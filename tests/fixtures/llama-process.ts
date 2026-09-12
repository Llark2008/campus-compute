import {createServer} from "node:http";
import {readFileSync} from "node:fs";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}
const port = Number(argument("--port"));
const delayed = process.argv.includes("--fixture-delay");
const apiKey = readFileSync(argument("--api-key-file"), "utf8").trim();
const server = createServer((request, response) => {
  const send = (status: number, body: unknown) => { response.writeHead(status, {"content-type": "application/json"}); response.end(JSON.stringify(body)); };
  if (request.headers.authorization !== `Bearer ${apiKey}`) return send(401, {error: "unauthorized"});
  if (request.method === "GET" && request.url === "/health") return delayed ? send(503, {status: "loading"}) : send(200, {status: "ok"});
  if (request.method === "GET" && request.url === "/props") return send(200, {build_info: "fixture-engine", chat_template: "fixture-template", total_slots: 1, default_generation_settings: {n_ctx: 2048}});
  const chunks: Buffer[] = [];
  request.on("data", chunk => chunks.push(chunk));
  request.on("end", () => {
    if (request.url === "/apply-template") send(200, {prompt: "fixture"});
    else if (request.url === "/tokenize") send(200, {tokens: [1, 2, 3]});
    else if (request.url === "/completion") send(200, {content: "OK", stop_type: "eos", tokens_evaluated: 3, tokens_predicted: 1, truncated: false});
    else send(404, {error: "missing"});
  });
});
server.listen(port, "127.0.0.1", () => process.stderr.write("CPU fixture backend ready\n"));
const close = () => server.close(() => process.exitCode = 0);
process.once("SIGTERM", close);
process.once("SIGINT", close);
