import { Router } from "express";
import { idParam } from "../lib/params.js";
import type { AppDb } from "../db/client.js";
import {
  listLists,
  getList,
  createList,
  updateList,
  deleteList,
  addListItem,
  deleteListItem,
} from "../services/listService.js";
import {
  createListSchema,
  updateListSchema,
  createListItemSchema,
  listsQuerySchema,
} from "../lib/validation.js";

export function createListsRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { kind } = listsQuerySchema.parse(req.query);
    res.json(listLists(db, kind));
  });

  router.post("/", (req, res) => {
    const input = createListSchema.parse(req.body);
    res.status(201).json(createList(db, input));
  });

  router.get("/:id", (req, res) => {
    res.json(getList(db, idParam(req, "id", "list id")));
  });

  router.patch("/:id", (req, res) => {
    const input = updateListSchema.parse(req.body);
    res.json(updateList(db, idParam(req, "id", "list id"), input));
  });

  router.delete("/:id", (req, res) => {
    deleteList(db, idParam(req, "id", "list id"));
    res.status(204).send();
  });

  router.post("/:id/items", (req, res) => {
    const input = createListItemSchema.parse(req.body);
    res.status(201).json(addListItem(db, idParam(req, "id", "list id"), input));
  });

  router.delete("/:id/items/:itemId", (req, res) => {
    deleteListItem(db, idParam(req, "id", "list id"), idParam(req, "itemId", "item id"));
    res.status(204).send();
  });

  return router;
}
