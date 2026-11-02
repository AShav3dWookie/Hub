import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { createEntityNote, listEntityNotes } from "../services/entityNotesService.js";
import { daysInMonth } from "@logger/shared";
import type { VoiceAction, VoiceReplyWithoutId } from "./actions.js";
import { listPeople } from "./people.js";
import { tidy } from "./text.js";

const input = z.object({
  personId: z
    .number()
    .int()
    .nullable()
    .describe("Whose date it is: their id from the context's people, matched by meaning; null if they aren't there."),
  name: z.string().describe("Their name as said."),
  tag: z.string().describe('What the date is, short, first letter capitalised: "Birthday", "Anniversary", "New job".'),
  month: z.number().int().describe("1 to 12."),
  day: z.number().int().describe("Day of the month."),
  year: z.number().int().nullable().describe("The year, only if one was said; else null."),
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The year an important date is stored under when none was said. Only month and day matter to
 * everything that reads it (it recurs every year), but the column holds a whole date: this one's
 * coming occurrence, or for 29 February the next leap year.
 */
function comingYear(month: number, day: number, today: string): number {
  let year = Number(today.slice(0, 4));
  if (`${year}-${pad(month)}-${pad(day)}` < today) year++;
  while (day > daysInMonth(year, month)) year++;
  return year;
}

/**
 * An `important_date` note on a person — what Home's upcoming dates and the birthday "In a week"
 * reminder read, so a date added by voice shows up there with nothing else to do. Only people the
 * hub knows: like tagging, voice never creates one.
 */
export const addImportantDate: VoiceAction<typeof input> = {
  name: "add_important_date",
  description: "Remember a date that comes round every year for a person: a birthday, an anniversary.",
  input,
  run(db, said, { text, parsedBy, today, record }): VoiceReplyWithoutId {
    const name = tidy(said.name);
    const person = listPeople(db).find((p) => p.id === said.personId);
    if (!person) {
      throw new AppError(422, `I don't know ${name || "who that is"}, so nothing was added. Add them in the app first`);
    }
    const tag = tidy(said.tag);
    if (!tag) throw new AppError(422, `Didn't catch what the date is in "${text}"`);
    const { month, day } = said;
    const year = said.year ?? (month >= 1 && month <= 12 ? comingYear(month, day, today) : 0);
    if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200 || day > daysInMonth(year, month)) {
      throw new AppError(422, `Didn't catch a date in "${text}"`);
    }
    const eventDate = `${year}-${pad(month)}-${pad(day)}`;
    const when = `${day} ${MONTHS[month - 1]}${said.year != null ? ` ${year}` : ""}`;

    // The same date under the same name is already there: say so rather than add a twin.
    const twin = listEntityNotes(db, person.id).find(
      (n) =>
        n.category === "important_date" &&
        n.tag?.toLowerCase() === tag.toLowerCase() &&
        n.eventDate?.slice(5) === eventDate.slice(5),
    );
    if (twin) {
      return {
        action: "add_important_date",
        note: null,
        parsedBy,
        message: `${person.name}'s ${tag} is already ${when}`,
      };
    }

    const note = createEntityNote(db, person.id, { category: "important_date", body: "", tag, eventDate });
    record({ kind: "note", id: note.id });
    return {
      action: "add_important_date",
      note: { id: note.id, entityId: person.id, tag, eventDate },
      parsedBy,
      message: `Added ${person.name}'s ${tag}, ${when}`,
    };
  },
};
