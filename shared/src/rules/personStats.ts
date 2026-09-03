import type { LoggableCategory } from "../categories.js";
import type { LogWithEntityDTO, PersonRef, PersonStats } from "../types.js";

/**
 * The roll-up shown on a person's profile: how many logs they appear on, which category they
 * appear in most, and who they appear with most.
 *
 * Everything is derived from the appearances list alone. The server used to run an extra query
 * for co-people, but each appearance already carries its tagged people, so both sides can share
 * one implementation over the same input.
 *
 * Both "most" questions break ties explicitly. Previously each side kept whichever candidate it
 * happened to see first, and the server (SQL row order) and the offline client (date-sorted
 * appearances) see them in different orders — so a person tied between two co-people got a
 * different answer online than offline.
 */
export function computePersonStats(
  personId: number,
  appearances: readonly LogWithEntityDTO[],
): PersonStats {
  const categoryCounts = new Map<LoggableCategory, number>();
  for (const log of appearances) {
    if (log.entity.category === "person") continue;
    const category = log.entity.category as LoggableCategory;
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  let favoriteCategory: LoggableCategory | null = null;
  let topCategoryCount = 0;
  for (const [category, count] of categoryCounts) {
    // Ties go to the alphabetically first category, so the answer never depends on input order.
    if (count > topCategoryCount || (count === topCategoryCount && favoriteCategory !== null && category < favoriteCategory)) {
      topCategoryCount = count;
      favoriteCategory = category;
    }
  }

  const coPeople = new Map<number, { name: string; count: number }>();
  for (const log of appearances) {
    for (const person of log.people) {
      if (person.id === personId) continue;
      const existing = coPeople.get(person.id);
      coPeople.set(person.id, { name: person.name, count: (existing?.count ?? 0) + 1 });
    }
  }

  let mostFrequentCoPerson: PersonRef | null = null;
  let topCoCount = 0;
  for (const [id, { name, count }] of coPeople) {
    const beatsOnCount = count > topCoCount;
    // Ties go to the alphabetically first name, then to the lower id.
    const beatsOnTie =
      count === topCoCount &&
      mostFrequentCoPerson !== null &&
      (name < mostFrequentCoPerson.name ||
        (name === mostFrequentCoPerson.name && id < mostFrequentCoPerson.id));
    if (beatsOnCount || beatsOnTie) {
      topCoCount = count;
      mostFrequentCoPerson = { id, name };
    }
  }

  return { totalLogs: appearances.length, favoriteCategory, mostFrequentCoPerson };
}
