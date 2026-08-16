import express from "express";

import api from "./api.js";
import { ensureDem } from "./services/dem.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use("/api", api);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

await ensureDem();

app.listen(port, () => {
  console.log(`BrumaWatch backend listening on :${port}`);
});
