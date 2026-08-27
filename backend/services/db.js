import { MongoClient } from "mongodb";

const url = process.env.MONGO_URL ?? "mongodb://mongo:27017";
const client = new MongoClient(url);

let ready = null;

function collections() {
  ready ??= (async () => {
    await client.connect();
    const database = client.db("azorwatch");

    const forecasts = database.collection("forecasts");
    const overlays = database.collection("overlays");
    await overlays.createIndex({ kind: 1, island: 1, runAt: 1 });

    for (const collection of [forecasts, overlays]) {
      const { deletedCount } = await collection.deleteMany({
        kind: { $exists: false },
      });
      if (deletedCount)
        console.log(`Mongo: dropped ${deletedCount} document(s) from before the sea forecast`);
    }

    console.log(`Mongo: connected to ${url}`);
    return { forecasts, overlays };
  })();

  return ready;
}

export async function findForecast(kind, island) {
  const { forecasts } = await collections();
  return forecasts.findOne(
    { _id: `${kind}:${island}` },
    { projection: { _id: 0, kind: 0 } },
  );
}

export async function findOverlay(kind, island, layer, time) {
  const { overlays } = await collections();
  return overlays.findOne(
    { _id: `${kind}:${island}:${layer}:${time}` },
    { projection: { _id: 0, etag: 1, png: 1 } },
  );
}

export async function saveForecast(kind, island, doc) {
  const { forecasts } = await collections();
  await forecasts.replaceOne(
    { _id: `${kind}:${island}` },
    { kind, ...doc },
    { upsert: true },
  );
}

export async function saveOverlays(kind, island, runAt, items) {
  const { overlays } = await collections();

  await overlays.bulkWrite(
    items.map(({ layer = "overall", time, etag, png }) => ({
      replaceOne: {
        filter: { _id: `${kind}:${island}:${layer}:${time}` },
        replacement: { kind, island, layer, time, runAt, etag, png },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  await overlays.deleteMany({ kind, island, runAt: { $ne: runAt } });
}
