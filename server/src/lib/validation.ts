import { z } from "zod";
import { CATEGORIES, LOGGABLE_CATEGORIES, NOTE_CATEGORIES } from "@logger/shared";
import { daysInMonth, daysBetween } from "./dates.js";

export const categorySchema = z.enum(CATEGORIES);
export const loggableCategorySchema = z.enum(LOGGABLE_CATEGORIES);
export const noteCategorySchema = z.enum(NOTE_CATEGORIES);

export const personTagSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).optional(),
});

export const createEntitySchema = z.object({
  category: categorySchema,
  title: z.string().trim().min(1),
  releaseYear: z.number().int().min(1800).max(2200).nullable().optional(),
  author: z.string().trim().min(1).nullable().optional(),
});

export const createLogSchema = z
  .object({
    entityId: z.number().int().positive().optional(),
    category: loggableCategorySchema.optional(),
    title: z.string().trim().min(1).optional(),
    releaseYear: z.number().int().min(1800).max(2200).nullable().optional(),
    author: z.string().trim().min(1).nullable().optional(),
    rating: z.number().int().min(1).max(5).nullable().optional().default(null),
    date: z.string().min(1),
    notes: z.string().nullable().optional().default(null),
    people: z.array(personTagSchema).default([]),
    autoDelete: z.boolean().optional().default(false),
  })
  .refine((data) => data.entityId != null || (data.category && data.title), {
    message: "Either entityId or category+title is required",
  });

export const updateLogSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional().default(null),
  date: z.string().min(1),
  notes: z.string().nullable().optional().default(null),
  people: z.array(personTagSchema).default([]),
  autoDelete: z.boolean().optional().default(false),
});

export const createAlbumSchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().trim().nullable().optional().default(null),
  dateStart: z.string().trim().min(1).nullable().optional().default(null),
  dateEnd: z.string().trim().min(1).nullable().optional().default(null),
  people: z.array(personTagSchema).default([]),
  eventLogIds: z.array(z.number().int().positive()).default([]),
});

export const updateAlbumSchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().trim().nullable().optional().default(null),
  dateStart: z.string().trim().min(1).nullable().optional().default(null),
  dateEnd: z.string().trim().min(1).nullable().optional().default(null),
});

export const albumEventSchema = z.object({
  logId: z.number().int().positive(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  qMode: z.enum(["all", "any"]).optional(),
  // "album" is not a real Category — the Search filter tab sends it to select searchAlbums().
  category: z.union([categorySchema, z.literal("album")]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
  authorContains: z.string().trim().min(1).optional(),
  releaseYearMin: z.coerce.number().int().min(1800).max(2200).optional(),
  releaseYearMax: z.coerce.number().int().min(1800).max(2200).optional(),
  sortBy: z.enum(["date", "title", "rating", "person"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  groupBy: z.enum(["entity", "log"]).optional(),
  visitSortBy: z.enum(["date", "rating", "person"]).optional(),
  visitSortOrder: z.enum(["asc", "desc"]).optional(),
});

export const galleryQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const syncChangesQuerySchema = z.object({
  /** rowSeq high-watermark; 0 (the default) bootstraps the whole dataset. Opaque to clients. */
  since: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
});

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }, "Invalid date");

export const calendarRangeQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to, { message: "from must be on or before to", path: ["from"] })
  .refine((q) => daysBetween(q.from, q.to) <= 45, { message: "range too large", path: ["to"] });

export const loginSchema = z.object({
  password: z.string().min(1),
});

export const createEntityNoteSchema = z
  .object({
    category: noteCategorySchema.optional().default("general"),
    body: z.string().trim().optional().default(""),
    tag: z.string().trim().min(1).optional(),
    eventDate: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.category === "important_date") {
      if (!data.tag) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tag is required for important_date notes", path: ["tag"] });
      }
      if (!data.eventDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "eventDate is required for important_date notes",
          path: ["eventDate"],
        });
      }
    } else if (!data.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "body is required", path: ["body"] });
    }
  });

export const updateEntityNoteSchema = z
  .object({
    category: noteCategorySchema.optional(),
    body: z.string().trim().optional().default(""),
    tag: z.string().trim().min(1).optional(),
    eventDate: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.category === "important_date") {
      if (!data.tag) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tag is required for important_date notes", path: ["tag"] });
      }
      if (!data.eventDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "eventDate is required for important_date notes",
          path: ["eventDate"],
        });
      }
    } else if (!data.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "body is required", path: ["body"] });
    }
  });

