# BrumaWatch

An app that predicts fog across the 9 Azores islands for today and the next 3 days in a 50×50m color-coded map (no fog / yellow / orange / red).

**Live demo:** https://afonsohj1812.github.io/BrumaWatch (rebuilt every 6 hours, so the forecast can be a few hours behind).

![Fog forecast over São Miguel](docs/preview.png)

## How it works

The forecast gives the height of the cloud base and the cloud top over each island. The elevation grid gives the height of the ground at every 50m cell. A cell is foggy when its elevation falls between the two, and the deeper it sits into the cloud, the lower the visibility.

1. **Forecast.** One Open-Meteo request covers all nine islands: surface temperature, dew
   point and wind, plus temperature, humidity and height on seven pressure levels from sea
   level to ~2000m.
2. **Vertical structure.** From that profile, find where the air reaches saturation (the
   cloud base) and where it dries out again (the cloud top).
3. **Terrain.** A 50m elevation grid per island, resampled from the Copernicus GLO-30 DEM.
4. **Intersect.** For each cell, compare its elevation with the cloud layer. Below the base
   is clear, inside it is fog that thickens with depth, above the top is clear again. That
   last case is why Pico's summit often stands in sunshine while its flanks are socked in.
5. **Serve.** Each island-hour is rendered as a small transparent PNG and drawn over a
   satellite map.

Visibility inside cloud comes from the adiabatic liquid water profile via Kunkel's relation,
bucketed into four classes:

| class  | visibility |
| ------ | ---------- |
| red    | 10m – 100m |
| orange | 100m – 1km |
| yellow | 1km – 10km |
| none   | > 10 km    |

## Running it

Everything runs in Docker.

```sh
# Run only once: download the DEM tiles and build the 50 m grids (a few minutes, ~20 MB)
docker compose run --rm backend node scripts/prepare-dem.js

docker compose up
```

Frontend on `localhost:5173`, backend on `localhost:3000`.

The DEM script ends with assertions against known summit heights and the archipelago's total
land area, and exits non-zero if they drift. A wrong decode still produces plausible-looking
elevations, so this is the only thing that catches it.

## API

| endpoint                             | returns                                           |
| ------------------------------------ | ------------------------------------------------- |
| `GET /api/islands`                   | island list with bounding boxes                   |
| `GET /api/forecast/:island`          | 4 days × 24 hours of worst-class per hour (~5 KB) |
| `GET /api/fog/:island/:hour.png`     | the overlay for one hour (1–30 KB)                |
| `GET /api/point/:island/:hour?x=&y=` | one cell: elevation, cloud base/top, visibility   |

The forecast summary and the pixels are separate on purpose. The summary is tiny and fetched
once per island to color the day and hour controls, while the pixels are paged in one hour at
a time as you scrub.

## Layout

```
backend/
  api.js                    all routes
  shared/
    fogMath.js              the model, pure and Node-free, shared with the browser
    islands.js              the nine islands and their bounding boxes
  services/
    forecast.js             Open-Meteo fetch + cache
    fogModel.js             wraps fogMath with the DEM, forecast and caching
    dem.js                  loads the elevation grids
    render.js               class grid -> PNG
  scripts/
    prepare-dem.js          one-off DEM preparation
    export-static.js        writes the API as files for Pages
  config/fogModel.json      every tunable constant
frontend/
  src/api.js                endpoint URLs, live or static
  src/lib/dem.js            reads the .bin grids in the browser
  src/components/           map + the four control panels
  src/composables/          data fetching and derived state
```

`fogMath.js` has no filesystem or network access on purpose: the frontend imports it directly
(bind-mounted in development, copied in CI) so the fog model exists once, not twice.

## Data

- Forecast: [Open-Meteo](https://open-meteo.com), no API key.
- Elevation: Copernicus GLO-30 DEM, public on AWS.
- Basemap: Esri World Imagery.

## Limitations

- **The model is not validated.** Every constant in `config/fogModel.json` is either standard
  physics or a plausible value chosen by hand and checked against a single day of output.
  Nothing has been compared against observed fog. It is a physically reasoned estimate, not a
  verified forecast.
- The mist rules and the whole windward block are the least grounded parts.
- Fog over water is not modelled, only land cells are classified.
- Deck thickness can jump between adjacent hours when humidity crosses a threshold.
- The overlay is drawn stretched in Web Mercator from a grid built in latitude, so cells sit
  up to ~12 m from their true position, well under one cell.
