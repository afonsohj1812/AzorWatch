import { MongoClient } from "mongodb";

const url = process.env.MONGO_URL ?? "mongodb://mongo:27017";
const client = new MongoClient(url);

let ready = null;

function collections() {
  ready ??= (async () => {
    await client.connect();
    const database = client.db("brumawatch");

    const forecasts = database.collection("forecasts");
    const overlays = database.collection("overlays");
    await overlays.createIndex({ island: 1, runAt: 1 });

    console.log(`mongo: connected to ${url}`);
    return { forecasts, overlays };
  })();

  return ready;
}

export async function findForecast(island) {
  const { forecasts } = await collections();
  return forecasts.findOne({ _id: island }, { projection: { _id: 0 } });
}

export async function findOverlay(island, time) {
  const { overlays } = await collections();
  return overlays.findOne(
    { _id: `${island}:${time}` },
    { projection: { _id: 0, etag: 1, png: 1 } },
  );
}

export async function saveForecast(island, doc) {
  const { forecasts } = await collections();
  await forecasts.replaceOne({ _id: island }, doc, { upsert: true });
}

export async function saveOverlays(island, runAt, items) {
  const { overlays } = await collections();

  await overlays.bulkWrite(
    items.map(({ time, etag, png }) => ({
      replaceOne: {
        filter: { _id: `${island}:${time}` },
        replacement: { island, time, runAt, etag, png },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  await overlays.deleteMany({ island, runAt: { $ne: runAt } });
}

export async function lastRunAge() {
  const { forecasts } = await collections();
  const newest = await forecasts.find().sort({ runAt: -1 }).limit(1).next();

  return newest ? Date.now() - Date.parse(newest.runAt) : Infinity;
}
