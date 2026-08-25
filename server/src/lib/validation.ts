import { z } from "zod";
import { CATEGORIES, LOGGABLE_CATEGORIES, NOTE_CATEGORIES } from "@logger/shared";

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
});

export const createLogSchema = z
  .object({
    entityId: z.number().int().positive().optional(),
    category: loggableCategorySchema.optional(),
    title: z.string().trim().min(1).optional(),
    rating: z.number().int().min(1).max(5).nullable().optional().default(null),
    date: z.string().min(1),
    notes: z.string().nullable().optional().default(null),
    people: z.array(personTagSchema).default([]),
  })
  .refine((data) => data.entityId != null || (data.category && data.title), {
    message: "Either entityId or category+title is required",
  });

export const updateLogSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional().default(null),
  date: z.string().min(1),
  notes: z.string().nullable().optional().default(null),
  people: z.array(personTagSchema).default([]),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  qMode: z.enum(["all", "any"]).optional(),
  category: categorySchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
  sortBy: z.enum(["date", "title", "rating", "person"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  groupBy: z.enum(["entity", "log"]).optional(),
  visitSortBy: z.enum(["date", "rating", "person"]).optional(),
  visitSortOrder: z.enum(["asc", "desc"]).optional(),
});

export const loginSchema = z.object({
  password: z.string().min(1),
});

export const createEntityNoteSchema = z.object({
  category: noteCategorySchema.optional().default("general"),
  body: z.string().trim().min(1),
});

export const updateEntityNoteSchema = z.object({
  category: noteCategorySchema.optional(),
  body: z.string().trim().min(1),
});

