const HOURS_PER_DAY = 24;

const asUtc = (date) => new Date(`${date}T00:00:00Z`);

const dayLabel = (date) =>
  asUtc(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const weekday = (date) =>
  asUtc(date).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });

export function percentileClass(counts, total, percentile) {
  const target = percentile * total;
  let seen = 0;

  for (let c = 0; c < counts.length; c++) {
    seen += counts[c];
    if (seen >= target) return c;
  }

  return counts.length - 1;
}

export function groupDays({ times, hourClass, names, dayOf, layers = {} }) {
  const ids = Object.keys(layers);

  const layerClassAt = (pick) =>
    ids.length
      ? { layerClass: Object.fromEntries(ids.map((id) => [id, pick(id)])) }
      : {};

  const days = [];

  for (let day = 0; day < hourClass.length / HOURS_PER_DAY; day++) {
    const start = day * HOURS_PER_DAY;
    const date = times[start].slice(0, 10);

    days.push({
      date,
      label: dayLabel(date),
      weekday: weekday(date),
      class: names[dayOf(hourClass, start)],
      ...layerClassAt(
        (id) => layers[id].names[layers[id].dayOf(layers[id].series, start)],
      ),
      hours: Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
        time: times[start + h],
        class: names[hourClass[start + h]],
        ...layerClassAt((id) => layers[id].names[layers[id].series[start + h]]),
      })),
    });
  }

  return days;
}
