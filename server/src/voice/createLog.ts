import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { createLog as createLogEntry } from "../services/logService.js";
import { findEntity } from "../services/entityService.js";
import {
  CATEGORY_FIELDS,
  CATEGORY_META,
  LOGGABLE_CATEGORIES,
  daysInMonth,
  isTimeOfDay,
  minutesOfDay,
  type CategoryFieldsConfig,
  type LoggableCategory,
} from "@logger/shared";
import type { VoiceAction, VoiceReplyWithoutId } from "./actions.js";
import { describeDay, tidy } from "./text.js";

/**
 * One action for every loggable category. Its fields and their descriptions come from
 * `CATEGORY_FIELDS`, so a category added there is available to voice with no voice code; the
 * rules decide which categories voice is used for and how to recognise them.
 */

/** "appointment", "movie, game" — the categories a field applies to, for its description. */
const having = (flag: keyof CategoryFieldsConfig) =>
  LOGGABLE_CATEGORIES.filter((c) => CATEGORY_FIELDS[c][flag] === true).join(", ") || "none";
const YEAR_ONLY = LOGGABLE_CATEGORIES.filter((c) => CATEGORY_FIELDS[c].dateGranularity === "year").join(", ");

/** Categories that are plans, so a date already gone is a mistake rather than a record. */
const FUTURE_ONLY: readonly LoggableCategory[] = ["appointment"];

const input = z.object({
  category: z.enum(LOGGABLE_CATEGORIES).describe("Which kind of entry, as the rules describe."),
  title: z
    .string()
    .describe("What it is, as a short title with its first letter capitalised, without the date or time words."),
  date: z
    .string()
    .describe(
      `The exact date, YYYY-MM-DD, worked out from today in the context. For ${YEAR_ONLY}, which keep ` +
        "only a year, any date in that year.",
    ),
  time: z
    .string()
    .nullable()
    .describe(`Local time of day, HH:MM 24-hour. Only for ${having("hasTime")}; null when none was said.`),
  autoDelete: z
    .boolean()
    .nullable()
    .describe(`Only for ${having("hasAutoDelete")}: false to keep it after it has passed; null for the usual.`),
  rating: z
    .number()
    .int()
    .nullable()
    .describe(`Only for ${having("hasRating")}: a rating out of 5 if one was said, else null.`),
  releaseYear: z
    .number()
    .int()
    .nullable()
    .describe(`Only for ${having("hasReleaseYear")}: the year it came out, if said, else null.`),
  author: z.string().nullable().describe(`Only for ${having("hasAuthor")}: the author, if said, else null.`),
  notes: z
    .string()
    .nullable()
    .describe("Anything else said that is worth keeping and isn't the title, date or time, else null."),
});

export type CreateLogInput = z.output<typeof input>;

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export const createLog: VoiceAction<typeof input> = {
  name: "create_log",
  description: "Add an entry to the diary: an appointment, a hang-out, a meal out, something watched, read or played.",
  input,
  run(db, said, { text, parsedBy, today, nowMinutes, record }): VoiceReplyWithoutId {
    const { category } = said;
    const fields = CATEGORY_FIELDS[category];

    const title = tidy(said.title);
    if (!title) throw new AppError(422, `Didn't catch what to add in "${text}"`);
    if (!isRealDate(said.date)) throw new AppError(422, `Didn't catch a date in "${text}"`);
    const date = fields.dateGranularity === "year" ? `${said.date.slice(0, 4)}-01-01` : said.date;

    const time = fields.hasTime ? said.time : null;
    if (time != null && !isTimeOfDay(time)) throw new AppError(422, `Didn't catch a time in "${text}"`);

    const when = fields.dateGranularity === "year" ? date.slice(0, 4) : describeDay(date, time, today);
    if (FUTURE_ONLY.includes(category)) {
      const gone = date < today || (date === today && time != null && minutesOfDay(time) <= nowMinutes);
      if (gone) throw new AppError(422, `${title}, ${when} is in the past, so nothing was added`);
    }

    // Undo takes the entry away too, but only if this command made it.
    const isNew = !findEntity(db, category, title);
    const rating = fields.hasRating && said.rating != null && said.rating >= 1 && said.rating <= 5 ? said.rating : null;
    const log = createLogEntry(db, {
      category,
      title,
      date,
      time,
      rating,
      notes: said.notes?.trim() || null,
      people: [],
      autoDelete: fields.hasAutoDelete ? (said.autoDelete ?? true) : false,
      releaseYear: fields.hasReleaseYear ? said.releaseYear : null,
      author: fields.hasAuthor ? said.author?.trim() || null : null,
    });
    if (isNew) record({ kind: "entity", id: log.entityId });
    record({ kind: "log", id: log.id });

    // An appointment is the usual case and needs no label; anything else says what it was.
    const what = category === "appointment" ? title : `${title} (${CATEGORY_META[category].label})`;
    return {
      action: "create_log",
      log: { id: log.id, entityId: log.entityId, category, title, date, time },
      parsedBy,
      message: `Added ${what}, ${when}`,
    };
  },
};
