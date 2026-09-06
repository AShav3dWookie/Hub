import { useState } from "react";
import { CARD_CLASS } from "./ui.js";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { AlbumDTO, LogWithEntityDTO, PersonRef, PersonTagInput } from "@logger/shared";
import { CATEGORY_META, categoryHasRating } from "@logger/shared";
import { StarRating } from "./StarRating.js";
import { PersonLinks } from "./PersonLinks.js";
import { PeopleTagInput } from "./PeopleTagInput.js";
import { LogPicker } from "./LogPicker.js";
import { formatLogDate } from "../lib/formatLogDate.js";

/**
 * The people and events halves of the album page, which was one 365-line function.
 */

const SECTION_HEADING =
  "text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

const REMOVE_BUTTON =
  "flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full hover:bg-slate-300 dark:hover:bg-slate-600";

/**
 * An album's people: the ones added to it directly, plus everyone tagged on a linked event.
 *
 * Only a directly-added person can be removed here — the rest are there because of an event,
 * and would come straight back. They are marked "via event" to say so.
 */
export function AlbumPeopleSection({
  people,
  directPersonIds,
  onAdd,
  onRemove,
}: {
  people: PersonRef[];
  directPersonIds: number[];
  onAdd: (person: PersonTagInput) => Promise<unknown>;
  onRemove: (personId: number) => void;
}) {
  const [draft, setDraft] = useState<PersonTagInput[]>([]);

  async function addDraft() {
    for (const tag of draft) {
      await onAdd(tag.id != null ? { id: tag.id } : { name: tag.name });
    }
    setDraft([]);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className={SECTION_HEADING}>People</h2>

      <div className="flex flex-wrap gap-2">
        {people.length === 0 && (
          <span className="text-sm text-slate-500 dark:text-slate-400">Nobody tagged yet.</span>
        )}
        {people.map((person) => (
          <span
            key={person.id}
            className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-slate-700 dark:text-white"
          >
            <Link to={`/person/${person.id}`} className="hover:underline">
              {person.name}
            </Link>
            {directPersonIds.includes(person.id) ? (
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                onClick={() => onRemove(person.id)}
                className={REMOVE_BUTTON}
              >
                <X size={14} />
              </button>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">via event</span>
            )}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <PeopleTagInput value={draft} onChange={setDraft} />
        {draft.length > 0 && (
          <button
            type="button"
            onClick={addDraft}
            className="min-h-[44px] self-start rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white dark:bg-slate-700"
          >
            Add to album
          </button>
        )}
      </div>
    </div>
  );
}

/** The logs an album references. Linking never modifies the event itself. */
export function AlbumEventsSection({
  events,
  onAdd,
  onRemove,
}: {
  events: LogWithEntityDTO[];
  onAdd: (logId: number) => void;
  onRemove: (logId: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className={SECTION_HEADING}>Events</h2>

      {events.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">No events linked yet.</p>
      )}

      <ul className="flex flex-col gap-2">
        {events.map((log) => (
          <li key={log.id} className={CARD_CLASS}>
            <div className="flex items-center justify-between">
              <Link
                to={`/entity/${log.entity.id}`}
                className="font-medium hover:underline dark:text-white"
              >
                {log.entity.title}
              </Link>
              <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                {CATEGORY_META[log.entity.category].label} ·{" "}
                {formatLogDate(log.date, log.entity.category)}
                <button
                  type="button"
                  aria-label={`Remove ${log.entity.title} from album`}
                  onClick={() => onRemove(log.id)}
                  className="flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  <X size={14} />
                </button>
              </span>
            </div>
            {categoryHasRating(log.entity.category) && <StarRating value={log.rating} readOnly />}
            <PersonLinks people={log.people} />
            {log.notes && (
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{log.notes}</p>
            )}
          </li>
        ))}
      </ul>

      <LogPicker excludeIds={events.map((e) => e.id)} onPick={(log) => onAdd(log.id)} />
    </div>
  );
}

export type { AlbumDTO };
