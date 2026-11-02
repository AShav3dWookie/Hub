/* eslint-disable no-console -- a command-line report: printing is the whole job. */
/**
 * Manual check of voice against the real model. It costs money, so it is deliberately not a
 * test: nothing in `npm test`, coverage or CI runs it. Run it by hand after setting up a key,
 * changing src/voice/rules.md, an action's schema or description, the prompt in
 * lib/voiceModel.ts, or VOICE_MODEL.
 *
 *   npm run voice:check
 *   npm run voice:check -- --server http://localhost:3000 --token hub_...
 *
 * The key comes from ANTHROPIC_API_KEY in the shell or in the repo-root .env (the same file
 * docker compose reads), so setting it up once covers both.
 *
 * 1. The phrase table: each phrase against a fixed hub, with the action and fields it should
 *    come back as. It is the regression net for the rules: every rule gets lines here. Reports
 *    pass/fail, latency, tokens and the cost of the run (well under a penny).
 * 2. With --server and --token: one command through a running server's POST /api/voice, which
 *    proves the server itself has the key (`parsedBy: "model"`). It really adds an item to that
 *    server's main list ("Voice check"), so tick it off afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModelVoiceParser } from "../lib/voiceModel.js";
import { findVoiceAction, type VoiceContext } from "../voice/actions.js";
import type { VoiceActionName } from "@logger/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = path.join(repoRoot, ".env");
if (!process.env.ANTHROPIC_API_KEY && fs.existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.VOICE_MODEL || "claude-haiku-5-5";

// Claude Haiku 5.5 list prices, per million tokens. Only used to print what a run cost.
const USD_PER_MTOK = { input: 0.1, output: 0.5 };

/** The hub every phrase is said to. Id 1 is the main list. */
const MAIN_LIST = 1;
const CONTEXT: VoiceContext = {
  lists: [
    { id: 1, name: "Shopping" },
    { id: 2, name: "M&S – Bangor" },
    { id: 3, name: "Sainsbury's – Bangor" },
    { id: 4, name: "Tesco Bangor" },
  ],
};

/**
 * Phrase → the action it should become and the fields that matter. A field left out of `want`
 * can be anything. Strings compare loosely (case, hyphens, spacing), and a `listId` of null
 * equals the main list's own id, since both land on the main list.
 */
const PHRASES: { say: string; action: VoiceActionName; want: Record<string, unknown> }[] = [
  // Shopping lists
  { say: "add eggs and milk to marks and spencer", action: "add_to_list", want: { listId: 2, items: ["eggs", "milk"] } },
  { say: "put fish and chips on the shopping list", action: "add_to_list", want: { listId: null, items: ["fish and chips"] } },
  { say: "add 6 eggs to sainsburys", action: "add_to_list", want: { listId: 3, items: ["6 eggs"] } },
  { say: "can you add some bin bags please", action: "add_to_list", want: { listId: null, items: ["bin bags"] } },
  {
    say: "add salt and vinegar crisps and bread to m and s",
    action: "add_to_list",
    want: { listId: 2, items: ["salt and vinegar crisps", "bread"] },
  },
  { say: "add bread to the lidl list", action: "add_to_list", want: { listId: null, items: ["bread"] } },
  {
    say: "add semi skimmed milk washing up liquid and tin foil",
    action: "add_to_list",
    want: { listId: null, items: ["semi skimmed milk", "washing up liquid", "tin foil"] },
  },
  { say: "add bananas to the sains brees list", action: "add_to_list", want: { listId: 3, items: ["bananas"] } },
  { say: "add tesco value beans to marks and spencers", action: "add_to_list", want: { listId: 2, items: ["tesco value beans"] } },
  { say: "add coffee to tesco", action: "add_to_list", want: { listId: 4, items: ["coffee"] } },
  { say: "what's on my list", action: "add_to_list", want: { items: [] } },
];

/** Compare loosely: case, hyphens and spacing don't matter ("Semi-skimmed" = "semi skimmed"). */
const loose = (s: string) => s.toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();

function normalise(field: string, value: unknown): unknown {
  if (field === "listId") return value ?? MAIN_LIST;
  if (typeof value === "string") return loose(value);
  if (Array.isArray(value)) return value.map((v) => normalise(field, v));
  return value;
}

/** The fields that came back wrong, as "field: got … want …" lines. */
function mismatches(got: Record<string, unknown>, want: Record<string, unknown>): string[] {
  return Object.entries(want)
    .filter(([field, value]) => JSON.stringify(normalise(field, got[field])) !== JSON.stringify(normalise(field, value)))
    .map(([field, value]) => `${field}: got ${JSON.stringify(got[field])}, want ${JSON.stringify(value)}`);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function checkPhrases(): Promise<boolean> {
  let inputTokens = 0;
  let outputTokens = 0;
  const parse = createModelVoiceParser({
    apiKey: apiKey!,
    model,
    onUsage: (u) => {
      inputTokens += u.input_tokens;
      outputTokens += u.output_tokens;
    },
  });

  console.log(`Phrase table — ${model}, ${PHRASES.length} phrases`);
  console.log("(the first request can be slow while the API compiles the tool schemas)\n");

  let failures = 0;
  for (const phrase of PHRASES) {
    const started = Date.now();
    try {
      const call = await parse(phrase.say, CONTEXT);
      const ms = Date.now() - started;
      // Checked as the server would, so an answer it would reject fails here too.
      const parsed = findVoiceAction(call.action)?.input.safeParse(call.input);
      const problems =
        call.action !== phrase.action
          ? [`action: got ${call.action}, want ${phrase.action}`]
          : !parsed?.success
            ? ["input doesn't fit the action's schema"]
            : mismatches(parsed.data as Record<string, unknown>, phrase.want);
      if (problems.length > 0) failures++;
      console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${String(ms).padStart(5)}ms  "${phrase.say}"`);
      console.log(`        ${call.action} ${JSON.stringify(call.input)}`);
      for (const problem of problems) console.log(`        ✗ ${problem}`);
    } catch (err) {
      failures++;
      console.log(`ERROR ${String(Date.now() - started).padStart(5)}ms  "${phrase.say}"`);
      console.log(`        ${(err as Error).message}`);
    }
  }

  const usd = (inputTokens * USD_PER_MTOK.input + outputTokens * USD_PER_MTOK.output) / 1_000_000;
  console.log(
    `\n${PHRASES.length - failures}/${PHRASES.length} passed · ${inputTokens} input + ${outputTokens} output tokens` +
      ` · about $${usd.toFixed(5)} for this run`,
  );
  return failures === 0;
}

async function checkServer(url: string, token: string): Promise<boolean> {
  console.log(`\nServer check — POST ${url}/api/voice`);
  const res = await fetch(`${url.replace(/\/$/, "")}/api/voice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "add voice check to the shopping list" }),
  });
  const body = (await res.json()) as { parsedBy?: string; message?: string; error?: string };
  console.log(`  ${res.status} ${JSON.stringify(body)}`);
  if (res.status !== 200) {
    console.log("  FAIL  the server refused the command (is the token right?)");
    return false;
  }
  if (body.parsedBy !== "model") {
    console.log("  FAIL  the server used the rules backup — it has no key, or can't reach the API");
    return false;
  }
  console.log('  PASS  the server understood it with the model. Tick "Voice check" off its main list.');
  return true;
}

async function main() {
  if (!apiKey) {
    console.error(
      "No ANTHROPIC_API_KEY. Put it in the repo-root .env (ANTHROPIC_API_KEY=sk-ant-...) or the shell.",
    );
    process.exit(2);
  }
  let ok = await checkPhrases();

  const url = argValue("--server");
  const token = argValue("--token");
  if (url || token) {
    if (!url || !token) {
      console.error("--server and --token go together.");
      process.exit(2);
    }
    ok = (await checkServer(url, token)) && ok;
  }
  process.exit(ok ? 0 : 1);
}

void main();
