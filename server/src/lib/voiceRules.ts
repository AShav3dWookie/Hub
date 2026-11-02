/**
 * The backup voice parser, for shopping (`add_to_list`) only, used when the model can't be
 * reached (no API key, no internet, a timeout, a refusal). It understands one shape — "[add|put] <items> [to|on|onto] [the|my]
 * <list> [list]" — and is deliberately timid:
 *
 *  - It never splits the items. "fish and chips" is one item and "eggs and milk" is two, and
 *    rules can't tell those apart, so "eggs and milk" lands as one entry for you to fix rather
 *    than "fish" and "chips" landing as two.
 *  - A list is matched only when every word you said is a word of exactly one list's name
 *    ("sainsburys" → "Sainsbury's – Bangor"). Anything else goes to the main list.
 *
 * Everything clever about understanding speech belongs to the model; this exists so a voice
 * command is never simply lost.
 */
import type { VoiceList } from "../voice/actions.js";
import type { AddToListInput } from "../voice/addToList.js";

/** Lowercase words only: "Sainsbury's – Bangor" → ["sainsburys", "bangor"]. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Words that name "a list" rather than which list. */
const GENERIC_TARGET = new Set(["shopping", "list", "lists", "main", "the", "my", "our"]);

/** The one list whose name contains every word of `target`, or null if none or several do. */
function matchList(target: string, lists: VoiceList[]): VoiceList | null {
  const wanted = words(target).filter((w) => w !== "list");
  if (wanted.length === 0 || wanted.every((w) => GENERIC_TARGET.has(w))) return null;
  const hits = lists.filter((l) => {
    const name = new Set(words(l.name));
    return wanted.every((w) => name.has(w));
  });
  return hits.length === 1 ? hits[0] : null;
}

const LEAD_IN = /^(?:(?:please|can you|could you|would you)\s+)*(?:add|put)(?:\s+|$)/i;
const FILLER = /^(?:some|a|an|the)\s+/i;
/**
 * The last " to " / " on " / " onto " splits items from list: "add tomatoes to tesco". The item
 * part may be empty ("add to the tesco list"), which is a command with nothing to add.
 */
const TARGET_SPLIT = /^(?:(.*)\s+)?(?:to|onto|on)\s+(?:the\s+|my\s+)?(.+?)$/i;

export function parseWithRules(text: string, lists: VoiceList[]): AddToListInput {
  const command = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  // The widget only ever adds, so a bare "eggs" with no verb is still an item.
  const body = command.replace(LEAD_IN, "");

  const split = TARGET_SPLIT.exec(body);
  if (split) {
    const [, itemPart = "", target] = split;
    const list = matchList(target, lists);
    // "… to the Tesco list" is plainly a list even if there's no Tesco list (main list, then);
    // "… to the wall" without a matching list was never about a list at all.
    const namesAList = list != null || /\blist$/i.test(target) || words(target).every((w) => GENERIC_TARGET.has(w));
    if (namesAList) return { listId: list?.id ?? null, items: [itemPart.replace(FILLER, "").trim()].filter(Boolean) };
  }

  return { listId: null, items: [body.replace(FILLER, "").trim()].filter(Boolean) };
}
