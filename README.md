# AzorWatch

An app that predicts fog across the 9 Azores islands for today and the next 3 days in a 50×50m color-coded map (no fog / yellow / orange / red).

**Live demo:** https://afonsohj1812.github.io/AzorWatch (rebuilt every 6 hours, so the forecast can be a few hours behind).

![Fog forecast over São Miguel](docs/preview.png)

## How it works

The forecast gives the height of the cloud base and the cloud top over each island. The elevation grid gives the height of the ground at every 50m cell. A cell is foggy when its elevation falls between the two, and the deeper it sits into the cloud, the lower the visibility.

1. **Forecast.** One Open-Meteo request covers all nine islands: surface temperature, dew
   point, wind and low cloud cover, plus temperature, humidity and height on seven pressure
   levels from sea level to ~2000m.
2. **Vertical structure.** From that profile, find where the air reaches saturation (the
   cloud base) and where it dries out again (the cloud top). If low cloud cover is under
   `cloudCover.minLow`, the hour is treated as cloudless and nothing is painted, however
   humid the profile looks.
3. **Terrain.** A 50m elevation grid per island, resampled from the Copernicus GLO-30 DEM.
4. **Intersect.** For each cell, compare its elevation with the cloud layer. Below the base
   is clear, inside it is fog that thickens with depth, above the top is clear again. That
   last case is why Pico's summit often stands in sunshine while its flanks are socked in.
5. **Store.** An hourly job runs the four steps above for all nine islands, renders each
   island-hour to a small transparent PNG, and writes the results to MongoDB.
6. **Serve.** The API only reads from MongoDB, so no request ever runs the model. The
   overlays are drawn over a satellite map.

Visibility inside cloud comes from the adiabatic liquid water profile via Kunkel's relation,
bucketed into four classes:

| class  | visibility |
| ------ | ---------- |
| red    | 10m – 100m |
| orange | 100m – 1km |
| yellow | 1km – 10km |
| none   | > 10 km    |

Those colors describe a single 50m pixel. The hour ticks and day circles use the same colors
for a different thing, how much of the island is affected: an hour is yellow past 25% of the
land fogged, orange past 50% and red past 75%, and a day averages its 24 hours (red 3, orange
2, yellow 1, none 0) and takes the whole part.

## Running it

Everything runs in Docker, including MongoDB.

```sh
docker compose up
```

Frontend on `localhost:5173`, backend on `localhost:3000`.

## API

| endpoint                             | returns                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `GET /api/islands`                   | island list with bounding boxes                      |
| `GET /api/forecast/:island`          | 4 days × 24 hours of class, plus conditions (~18 KB) |
| `GET /api/fog/:island/:hour.png`     | the overlay for one hour (1–30 KB)                   |
| `GET /api/point/:island/:hour?x=&y=` | one cell: elevation, cloud base/top, visibility      |

The forecast summary and the pixels are separate on purpose. The summary is small and fetched
once per island to color the day and hour controls, while the pixels are paged in one hour at
a time as you scrub. Its `conditions` array also carries the cloud base, top and the depth
thresholds, which is what lets the static build classify a single cell in the browser with no
server behind it.

## Layout

```
backend/
  server.js                 the four routes, plus the hourly cron
  export-static.js          writes the API as files for Pages
  config/
    islands.js              the nine islands and their bounding boxes
    model.json              every tunable constant, and the class colors
  services/
    fogMath.js              the model, pure and Node-free, shared with the browser
    fogModel.js             binds fogMath to the DEM and forecast, renders PNGs, runs the pipeline
    forecast.js             Open-Meteo fetch + cache
    dem.js                  builds the elevation grids, then loads them
    db.js                   every MongoDB read and write
frontend/
  src/api.js                endpoint URLs, live or static
  src/components/           map + the four control panels
  src/composables/          data fetching and derived state
```

`server.js` and `export-static.js` are the only two files you run. Everything else is imported.

`fogMath.js` has no filesystem or network access on purpose: the frontend imports it directly,
with `backend/services` and `backend/config` bind-mounted into the frontend container, so the
fog model and the class colors exist once rather than twice.

## Data

- Forecast: [Open-Meteo](https://open-meteo.com), no API key.
- Elevation: Copernicus GLO-30 DEM, public on AWS.
- Basemap: Esri World Imagery.

## Limitations

- **Cloud presence is a single number for the whole island.** The profile always yields a base
  and a top, so `cloud_cover_low` is what decides whether any of it gets painted. That figure
  is one percentage sampled at the island center for the whole 0–3km column: it says some low
  cloud exists nearby, not that it sits at the modeled base, and not which part of the island
  is under it. Above the threshold the entire island is painted, below it none of it is, so an
  hour at 39% cover shows nothing and an hour at 40% shows everything. Partial cover is the
  common case here and it is not rendered as partial.
- **The pressure levels cannot resolve a low cloud base.** The lowest two are ~110m and ~320m,
  and Azorean stratus routinely sits between them. Any base in that band is a straight-line
  interpolation across a 210m gap, and below 110m the model can only fall back to the LCL.
- **The model is not validated.** Every constant in `config/model.json` is either standard
  physics or a plausible value chosen by hand and checked against a single day of output.
  Nothing has been compared against observed fog. It is a physically reasoned estimate, not a
  verified forecast.
