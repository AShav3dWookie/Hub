/**
 * A stand-in for the Anthropic Messages API, for the suites that drive a real hub end to end
 * (e2e/serve.mjs, companion-app/scripts/contract-test.sh). The hub is started with
 * ANTHROPIC_BASE_URL pointing here and a fake ANTHROPIC_API_KEY, so voice commands go through
 * the real model code (lib/voiceModel.ts, the SDK, the tool schemas) and cost nothing: the key
 * is no good to the real API even if the base URL were wrong.
 *
 * It understands one shape, "add|put <item> [to|on <list>]", as a single item, and answers
 * not_supported to anything else. That is enough to prove the plumbing; understanding speech is
 * the real model's job, and `npm run voice:check` is where that gets tested.
 *
 *   node scripts/fakeVoiceModel.mjs [port]     (default 8787)
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

const words = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const GENERIC = new Set(["list", "shopping", "main", "the", "my"]);

/** The tool call the stand-in makes for a command, given the hub's context. */
export function fakeAnswer(command, context) {
  const said = command.trim().replace(/[.!?]+$/, "");
  const add = /^(?:add|put)\b\s*(.*?)(?:\s+(?:to|onto|on)\s+(.+))?$/i.exec(said);
  if (!add) return { name: "not_supported", input: { reason: "the stand-in model only adds to lists" } };
  const [, item = "", target] = add;
  const wanted = target ? words(target).filter((w) => !GENERIC.has(w)) : [];
  const list = wanted.length
    ? (context.lists ?? []).find((l) => wanted.every((w) => words(l.name).includes(w)))
    : null;
  return { name: "add_to_list", input: { listId: list?.id ?? null, items: item ? [item] : [] } };
}

export function createFakeVoiceModel() {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "fake model" } }));
        return;
      }
      const request = JSON.parse(body);
      const turn = String(request.messages?.[0]?.content ?? "");
      const context = JSON.parse(/<context>([\s\S]*)<\/context>/.exec(turn)?.[1] ?? "{}");
      const command = /<command>([\s\S]*)<\/command>/.exec(turn)?.[1] ?? "";
      const { name, input } = fakeAnswer(command, context);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: request.model,
          content: [{ type: "tool_use", id: "toolu_fake", name, input }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      );
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 8787);
  createFakeVoiceModel().listen(port, () => console.log(`[fake model] listening on :${port}`));
}
