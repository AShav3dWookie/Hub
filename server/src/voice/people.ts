import { asc, eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities } from "../db/schema.js";

/** A person as the model sees them. */
export interface VoicePerson {
  id: number;
  name: string;
}

/** Every person, by name: what the model may tag, and what the server checks its ids against. */
export function listPeople(db: AppDb): VoicePerson[] {
  return db
    .select({ id: entities.id, name: entities.title })
    .from(entities)
    .where(eq(entities.category, "person"))
    .orderBy(asc(entities.title), asc(entities.id))
    .all();
}
