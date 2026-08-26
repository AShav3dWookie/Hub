import { eq, and, like, sql } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities } from "../db/schema.js";
import { normalizeTitle } from "../lib/normalize.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import type { Category, EntitySummary } from "@logger/shared";

export function toEntitySummary(row: typeof entities.$inferSelect): EntitySummary {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    createdAt: row.createdAt,
    releaseYear: row.releaseYear,
    author: row.author,
  };
}

export interface EntityCreationFields {
  releaseYear?: number | null;
  author?: string | null;
}

/** Find an existing entity by category+title (case/whitespace-insensitive), or create a new one. */
export function findOrCreateEntity(
  db: AppDb,
  category: Category,
  title: string,
  fields: EntityCreationFields = {},
): typeof entities.$inferSelect {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new BadRequestError("Title is required");
  }
  const normalizedTitle = normalizeTitle(trimmedTitle);

  const existing = db
    .select()
    .from(entities)
    .where(and(eq(entities.category, category), eq(entities.normalizedTitle, normalizedTitle)))
    .get();

  if (existing) {
    return existing;
  }

  const inserted = db
    .insert(entities)
    .values({
      category,
      title: trimmedTitle,
      normalizedTitle,
      releaseYear: fields.releaseYear ?? null,
      author: fields.author ?? null,
    })
    .returning()
    .get();

  return inserted;
}

export function createBareEntity(
  db: AppDb,
  category: Category,
  title: string,
  fields: EntityCreationFields = {},
): typeof entities.$inferSelect {
  return findOrCreateEntity(db, category, title, fields);
}

export function getEntityById(db: AppDb, id: number): typeof entities.$inferSelect {
  const row = db.select().from(entities).where(eq(entities.id, id)).get();
  if (!row) {
    throw new NotFoundError(`Entity ${id} not found`);
  }
  return row;
}

export interface EntityAutocompleteResult {
  id: number;
  title: string;
  category: Category;
}

export function searchEntitiesByTitle(
  db: AppDb,
  category: Category,
  query: string,
  limit = 10,
): EntityAutocompleteResult[] {
  const normalizedQuery = normalizeTitle(query);
  const rows = db
    .select({ id: entities.id, title: entities.title, category: entities.category })
    .from(entities)
    .where(
      and(
        eq(entities.category, category),
        like(entities.normalizedTitle, `%${normalizedQuery}%`),
      ),
    )
    .orderBy(sql`${entities.title} collate nocase`)
    .limit(limit)
    .all();
  return rows;
}
