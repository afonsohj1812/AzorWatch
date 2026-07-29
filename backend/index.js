import express from "express";
import cors from "cors";

import api from "./api.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use("/api", api);

app.listen(port, () => {
  console.log(`BrumaWatch backend listening on :${port}`);
});
