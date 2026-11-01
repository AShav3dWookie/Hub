/* eslint-disable no-console -- a command-line report: printing is the whole job. */
/**
 * Manual check of the voice parser against the real model. It costs money, so it is deliberately
 * not a test: nothing in `npm test`, coverage or CI runs it. Run it by hand after setting up a
 * key, changing the prompt in lib/voiceModel.ts, or changing VOICE_MODEL.
 *
 *   npm run voice:check
 *   npm run voice:check -- --server http://localhost:3000 --token hub_...
 *
 * The key comes from ANTHROPIC_API_KEY in the shell or in the repo-root .env (the same file
 * docker compose reads), so setting it up once covers both.
 *
 * 1. Parser check: a fixed set of phrases against fixed lists, each answer compared with what it
 *    should be. Reports pass/fail, latency, tokens and the cost of the run (well under a penny).
 * 2. With --server and --token: one command through a running server's POST /api/voice, which
 *    proves the server itself has the key (`parsedBy: "model"`). It really adds an item to that
 *    server's main list ("Voice check"), so tick it off afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModelVoiceParser } from "../lib/voiceModel.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = path.join(repoRoot, ".env");
if (!process.env.ANTHROPIC_API_KEY && fs.existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.VOICE_MODEL || "claude-haiku-5-5";

// Claude Haiku 5.5 list prices, per million tokens. Only used to print what a run cost.
const USD_PER_MTOK = { input: 0.1, output: 0.5 };

const LISTS = [
  { id: 1, name: "Shopping", isDefault: true },
  { id: 2, name: "M&S – Bangor", isDefault: false },
  { id: 3, name: "Sainsbury's – Bangor", isDefault: false },
  { id: 4, name: "Tesco Bangor", isDefault: false },
];

/** `list` undefined means "any list is fine" — for commands that should add nothing. */
const CASES: { say: string; list?: number | null; items: string[] }[] = [
  { say: "add eggs and milk to marks and spencer", list: 2, items: ["eggs", "milk"] },
  { say: "put fish and chips on the shopping list", list: null, items: ["fish and chips"] },
  { say: "add 6 eggs to sainsburys", list: 3, items: ["6 eggs"] },
  { say: "can you add some bin bags please", list: null, items: ["bin bags"] },
  {
    say: "add salt and vinegar crisps and bread to m and s",
    list: 2,
    items: ["salt and vinegar crisps", "bread"],
  },
  { say: "add bread to the lidl list", list: null, items: ["bread"] },
  {
    say: "add semi skimmed milk washing up liquid and tin foil",
    list: null,
    items: ["semi skimmed milk", "washing up liquid", "tin foil"],
  },
  { say: "add bananas to the sains brees list", list: 3, items: ["bananas"] },
  { say: "add tesco value beans to marks and spencers", list: 2, items: ["tesco value beans"] },
  { say: "add coffee to tesco", list: 4, items: ["coffee"] },
  { say: "what's on my list", items: [] },
];

/** Compare loosely: case, hyphens and spacing don't matter ("Semi-skimmed" = "semi skimmed"). */
const loose = (s: string) => s.toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();
const listName = (id: number | null | undefined) =>
  id === undefined ? "(any)" : id === null ? "(main)" : (LISTS.find((l) => l.id === id)?.name ?? `#${id}`);

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function checkParser(): Promise<boolean> {
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

  console.log(`Parser check — ${model}, ${CASES.length} phrases`);
  console.log("(the first request can be slow while the API compiles the output schema)\n");

  let failures = 0;
  for (const c of CASES) {
    const started = Date.now();
    try {
      const got = await parse(c.say, LISTS);
      const ms = Date.now() - started;
      // Compare where the items land, as voiceService resolves it: null and the main list's own
      // id both mean the main list ("the shopping list" when the main list is called Shopping).
      const lands = (id: number | null) => id ?? LISTS.find((l) => l.isDefault)!.id;
      const listOk = c.list === undefined || lands(got.listId) === lands(c.list);
      const itemsOk =
        JSON.stringify(got.items.map(loose)) === JSON.stringify(c.items.map(loose));
      const ok = listOk && itemsOk;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${String(ms).padStart(5)}ms  "${c.say}"`);
      console.log(`        got:  ${listName(got.listId)} ← ${JSON.stringify(got.items)}`);
      if (!ok) console.log(`        want: ${listName(c.list)} ← ${JSON.stringify(c.items)}`);
    } catch (err) {
      failures++;
      console.log(`ERROR ${String(Date.now() - started).padStart(5)}ms  "${c.say}"`);
      console.log(`        ${(err as Error).message}`);
    }
  }

  const usd = (inputTokens * USD_PER_MTOK.input + outputTokens * USD_PER_MTOK.output) / 1_000_000;
  console.log(
    `\n${CASES.length - failures}/${CASES.length} passed · ${inputTokens} input + ${outputTokens} output tokens` +
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
  let ok = await checkParser();

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
