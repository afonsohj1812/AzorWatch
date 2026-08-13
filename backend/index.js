import express from "express";
import cors from "cors";

import api from "./api.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use("/api", api);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  console.log(`BrumaWatch backend listening on :${port}`);
});
