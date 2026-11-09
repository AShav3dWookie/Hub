import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { handleVoiceCommand as handle } from "./voiceService.js";
import type { AddToListReply } from "@logger/shared";
import type { AppDb } from "../db/client.js";
import { addListItem, createList, getList, listLists } from "./listService.js";
import type { VoiceParser } from "../lib/voiceModel.js";
import { AppError } from "../lib/errors.js";
import { listLogs } from "./serverLogService.js";

/** Monday 2 November 2026, 10:00 in London (GMT, so 10:00Z). */
const CLOCK = { now: new Date("2026-11-02T10:00:00Z"), timeZone: "Europe/London" };

/** The shopping tests below: every reply is an add_to_list one. */
const handleVoiceCommand = (db: AppDb, text: string, parser: VoiceParser | null) =>
  handle(db, text, parser, CLOCK) as Promise<AddToListReply>;

describe("handleVoiceCommand", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
  });

  function setup() {
    ctx = createTestDb();
    const main = listLists(ctx.db).find((l) => l.isDefault)!;
    const ms = createList(ctx.db, { name: "M&S – Bangor" });
    return { main, ms };
  }

  const itemsOn = (id: number) => getList(ctx.db, id).items.map((i) => i.text);
  const model = (answer: { listId: number | null; items: string[] }): VoiceParser =>
    vi.fn().mockResolvedValue({ action: "add_to_list", input: answer });

  it("adds what the model understood to the list it chose", async () => {
    const { ms } = setup();
    const result = await handleVoiceCommand(
      ctx.db,
      "add eggs and milk to marks and spencer",
      model({ listId: ms.id, items: ["Eggs", "Milk"] }),
    );

    expect(itemsOn(ms.id)).toEqual(["Eggs", "Milk"]);
    expect(result).toEqual({
      action: "add_to_list",
      list: { id: ms.id, name: "M&S – Bangor" },
      added: ["Eggs", "Milk"],
      alreadyOnList: [],
      parsedBy: "model",
      message: "Added Eggs and Milk to M&S – Bangor",
      commandId: expect.any(Number),
    });
  });

  it("gives the model the shopping lists to choose from", async () => {
    const { main, ms } = setup();
    const parser = model({ listId: null, items: ["Eggs"] });
    await handleVoiceCommand(ctx.db, "add eggs", parser);
    expect(vi.mocked(parser).mock.calls[0][1].lists.map((l) => l.id).sort()).toEqual([main.id, ms.id].sort());
  });

  it("uses the main list when the model names none", async () => {
    const { main } = setup();
    const result = await handleVoiceCommand(ctx.db, "add eggs", model({ listId: null, items: ["Eggs"] }));
    expect(result.list.id).toBe(main.id);
    expect(itemsOn(main.id)).toEqual(["Eggs"]);
  });

  it("never trusts a list id the model made up", async () => {
    const { main } = setup();
    const result = await handleVoiceCommand(ctx.db, "add eggs", model({ listId: 999, items: ["Eggs"] }));
    expect(result.list.id).toBe(main.id);
  });

  const nothingOnAnyList = () => listLists(ctx.db).every((l) => getList(ctx.db, l.id).items.length === 0);

  it("refuses every command when there's no model, rather than guessing at it", async () => {
    setup();
    // What the rules backup once put on the shopping list word for word.
    for (const said of ["add an appointment for a haircut on the 24th of November at 6:30", "add eggs"]) {
      const err = await handleVoiceCommand(ctx.db, said, null).catch((e: unknown) => e);
      expect(err).toMatchObject({ statusCode: 503, message: expect.stringContaining("no Anthropic key") });
    }
    expect(nothingOnAnyList()).toBe(true);
  });

  it.each([
    ["fails", () => Promise.reject(new Error("timeout"))],
    ["answers with an action that doesn't exist", () => Promise.resolve({ action: "delete_everything", input: {} })],
    [
      "answers with input that doesn't fit the action",
      () => Promise.resolve({ action: "add_to_list", input: { list: "Tesco", items: "eggs" } }),
    ],
  ])("refuses, saving nothing, when the model %s", async (_case, parser: VoiceParser) => {
    setup();
    const err = await handleVoiceCommand(ctx.db, "add eggs", parser).catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 503, message: expect.stringMatching(/^Couldn't get through to Claude/) });
    expect(nothingOnAnyList()).toBe(true);
  });

  it("gives the model the local date, weekday and time where the hub is", async () => {
    setup();
    const parser = model({ listId: null, items: ["Eggs"] });
    // 23:30Z on Friday 31 July is already 00:30 on Saturday 1 August in London (BST).
    await handle(ctx.db, "add eggs", parser, { now: new Date("2026-07-31T23:30:00Z"), timeZone: "Europe/London" });
    expect(vi.mocked(parser).mock.calls[0][1]).toMatchObject({
      today: "2026-08-01",
      weekday: "Saturday",
      time: "00:30",
      timeZone: "Europe/London",
    });
  });

  it("reports items the list already has instead of adding them twice", async () => {
    const { main } = setup();
    addListItem(ctx.db, main.id, { text: "Eggs" });
    const result = await handleVoiceCommand(
      ctx.db,
      "add eggs and milk",
      model({ listId: null, items: ["eggs", "Milk", "MILK"] }),
    );

    expect(itemsOn(main.id)).toEqual(["Eggs", "Milk"]);
    expect(result).toMatchObject({ added: ["Milk"], alreadyOnList: ["Eggs"] });
    expect(result.message).toBe("Added Milk to Shopping. Eggs is already on Shopping");
  });

  it("capitalises an all-lowercase item but leaves deliberate casing alone", async () => {
    const { main } = setup();
    await handleVoiceCommand(ctx.db, "x", model({ listId: null, items: ["  bin   bags ", "iPhone charger"] }));
    expect(itemsOn(main.id)).toEqual(["Bin bags", "iPhone charger"]);
  });

  it("is a 422 with a readable message when there's nothing to add", async () => {
    setup();
    const err = await handleVoiceCommand(ctx.db, "hello there", model({ listId: null, items: ["  "] })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 422, message: 'Didn\'t catch anything to add in "hello there"' });
  });
});

/**
 * What the hub's log says about each command — the record that answers "why did it put my
 * appointment on the shopping list?" after the fact (docs/logs.md).
 */
describe("handleVoiceCommand's log", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  const voiceLog = () => listLogs(ctx.db, { source: "voice" });

  it("records what was heard, the action the model chose and the reply", async () => {
    ctx = createTestDb();
    const parser: VoiceParser = vi.fn().mockResolvedValue({ action: "add_to_list", input: { listId: null, items: ["Eggs"] } });
    await handle(ctx.db, "add eggs", parser, CLOCK, null);

    expect(voiceLog()).toEqual([
      expect.objectContaining({
        level: "info",
        message: '"add eggs" → add_to_list: Added Eggs to Shopping',
        data: expect.objectContaining({
          text: "add eggs",
          action: "add_to_list",
          input: { listId: null, items: ["Eggs"] },
          commandId: expect.any(Number),
          ms: expect.any(Number),
        }),
      }),
    ]);
  });

  it("logs an error saying why, when the model failed and the command was refused", async () => {
    ctx = createTestDb();
    const parser: VoiceParser = vi.fn().mockRejectedValue(new Error("Connection error."));
    await expect(handle(ctx.db, "add milk", parser, CLOCK, null)).rejects.toBeInstanceOf(AppError);

    expect(voiceLog()).toEqual([
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining('"add milk" → refused (503)'),
        data: expect.objectContaining({ modelError: "Connection error." }),
      }),
    ]);
  });

  it("keeps the model's answer when it didn't fit the action", async () => {
    ctx = createTestDb();
    const answer = { action: "create_log", input: { category: "appointment" } };
    const parser: VoiceParser = vi.fn().mockResolvedValue(answer);
    await handle(ctx.db, "dentist on tuesday", parser, CLOCK, null).catch(() => {});

    const [entry] = voiceLog();
    expect(entry.data).toMatchObject({ modelAnswer: answer, modelError: expect.stringContaining("schema") });
  });

  it("says there's no model, and logs the refusal as an error, for an appointment without one", async () => {
    ctx = createTestDb();
    await expect(handle(ctx.db, "dentist next tuesday at 3", null, CLOCK, null)).rejects.toBeInstanceOf(AppError);

    expect(voiceLog()).toEqual([
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining('"dentist next tuesday at 3" → refused (503): Voice commands need Claude'),
        data: expect.objectContaining({ modelError: expect.stringContaining("ANTHROPIC_API_KEY") }),
      }),
    ]);
  });
});
