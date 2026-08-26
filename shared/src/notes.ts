/**
 * Hardcoded note-category list, mirroring the CATEGORIES pattern in categories.ts.
 * Extend later by editing this const + NOTE_CATEGORY_META.
 */
export const NOTE_CATEGORIES = ["general", "gift_idea", "conversation_topic", "important_date"] as const;

export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export interface NoteCategoryMeta {
  category: NoteCategory;
  label: string;
}

export const NOTE_CATEGORY_META: Record<NoteCategory, NoteCategoryMeta> = {
  general: { category: "general", label: "General" },
  gift_idea: { category: "gift_idea", label: "Gift idea" },
  conversation_topic: { category: "conversation_topic", label: "Conversation topic" },
  important_date: { category: "important_date", label: "Important date" },
};
