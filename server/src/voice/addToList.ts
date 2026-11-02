import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { addListItem, getList, listLists } from "../services/listService.js";
import { LIST_ITEM_MAX_LENGTH, normalizeTitle, type AddToListReply } from "@logger/shared";
import type { VoiceAction } from "./actions.js";
import { joinNames, tidy } from "./text.js";

const input = z.object({
  listId: z
    .number()
    .int()
    .nullable()
    .describe(
      "The id of the list the command names, from the context's lists. null when it names no " +
        "particular list, or one that isn't among them. Never invent an id.",
    ),
  items: z.array(z.string()).describe("Each thing to add, one entry per item."),
});

/** `listId` null means no list was named (or none matched) — the main list then. */
export type AddToListInput = z.output<typeof input>;

/**
 * Shopping. The server, not the parser, decides what is written: a list id it doesn't know
 * becomes the main list, and items already on the list are reported rather than re-added.
 */
export const addToList: VoiceAction<typeof input> = {
  name: "add_to_list",
  description: "Add items to one of the shopping lists.",
  input,
  run(db, { listId, items: said }, { text, parsedBy }): AddToListReply {
    // One entry per distinct item, compared the way the list dedupes them.
    const seen = new Set<string>();
    const items = said.map((item) => tidy(item, LIST_ITEM_MAX_LENGTH)).filter((item) => {
      const key = normalizeTitle(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (items.length === 0) {
      throw new AppError(422, `Didn't catch anything to add in "${text}"`);
    }

    const lists = listLists(db, "shopping");
    const target = lists.find((l) => l.id === listId) ?? lists.find((l) => l.isDefault)!;
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
      action: "add_to_list",
      list: { id: target.id, name: target.name },
      added,
      alreadyOnList,
      parsedBy,
      message,
    };
  },
};
