import type { AppDb } from "../db/client.js";
import { AppError } from "../lib/errors.js";
import { parseWithRules } from "../lib/voiceRules.js";
import type { ParsedVoiceCommand, VoiceParser } from "../lib/voiceModel.js";
import { addListItem, getList, listLists } from "./listService.js";
import {
  LIST_ITEM_MAX_LENGTH,
  normalizeTitle,
  type VoiceCommandResponse,
  type VoiceParsedBy,
} from "@logger/shared";

/** "eggs", "eggs and milk", "eggs, milk and bread". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Speech recognisers often hand back all-lowercase; leave anything else ("iPhone") alone. */
function tidy(item: string): string {
  const text = item.trim().replace(/\s+/g, " ").slice(0, LIST_ITEM_MAX_LENGTH);
  return text === text.toLowerCase() ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Apply a spoken command to the shopping lists.
 *
 * The model (when there is one) does the understanding; any failure — no key, a timeout, a
 * refusal, an unusable answer — falls back to the rules parser, so a command is never lost.
 * Either way the server, not the parser, decides what is written: a list id it doesn't know
 * becomes the main list, and items already on the list are reported rather than re-added.
 */
export async function handleVoiceCommand(
  db: AppDb,
  text: string,
  parseWithModel: VoiceParser | null,
): Promise<VoiceCommandResponse> {
  const lists = listLists(db, "shopping");

  let parsed: ParsedVoiceCommand | null = null;
  let parsedBy: VoiceParsedBy = "model";
  if (parseWithModel) {
    try {
      parsed = await parseWithModel(text, lists);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[voice] model parser failed, using the rules backup: ${(err as Error).message}`);
    }
  }
  if (!parsed) {
    parsed = parseWithRules(text, lists);
    parsedBy = "rules";
  }

  // One entry per distinct item, compared the way the list dedupes them.
  const seen = new Set<string>();
  const items = parsed.items.map(tidy).filter((item) => {
    const key = normalizeTitle(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (items.length === 0) {
    throw new AppError(422, `Didn't catch anything to add in "${text}"`);
  }

  const target = lists.find((l) => l.id === parsed.listId) ?? lists.find((l) => l.isDefault)!;
  const already = new Set(getList(db, target.id).items.map((i) => normalizeTitle(i.text)));
  const added: string[] = [];
  const alreadyOnList: string[] = [];
  db.transaction(() => {
    for (const item of items) {
      if (already.has(normalizeTitle(item))) {
        alreadyOnList.push(item);
      } else {
        addListItem(db, target.id, { text: item });
        added.push(item);
      }
    }
  });

  const parts: string[] = [];
  if (added.length > 0) parts.push(`Added ${joinNames(added)} to ${target.name}`);
  if (alreadyOnList.length > 0) {
    parts.push(
      `${joinNames(alreadyOnList)} ${alreadyOnList.length === 1 ? "is" : "are"} already on ${target.name}`,
    );
  }
  // The backup never splits items, so a multi-item command lands as one — worth a glance.
  const message = parts.join(". ") + (parsedBy === "rules" ? " (simple parser — check it)" : "");

  return {
    action: "add",
    list: { id: target.id, name: target.name },
    added,
    alreadyOnList,
    parsedBy,
    message,
  };
}
