import { Router } from "express";

import { islands } from "./shared/islands.js";

const api = Router();

api.get("/health", (req, res) => {
  res.json({ ok: true, islands: islands.length });
});

api.get("/islands", (req, res) => {
  res.json(islands);
});

api.get("/forecast/:islandId", (req, res) => {
  res.status(501).json({ error: "not implemented" });
});

api.get("/fog/:islandId/:hour.png", (req, res) => {
  res.status(501).json({ error: "not implemented" });
});

export default api;
