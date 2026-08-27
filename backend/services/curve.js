export function ramp(value, from, to) {
  if (!Number.isFinite(value)) return 1;

  const span = to - from;
  if (span === 0) return 0;

  return Math.min(1, Math.max(0, (value - from) / span));
}

export function decayed(values, index, hours, decay) {
  let sum = 0;
  let weights = 0;

  for (let back = 0; back < hours; back++) {
    const i = index - back;
    if (i < 0) break;

    const value = values?.[i];
    if (!Number.isFinite(value)) continue;

    const weight = Math.pow(decay, back);
    sum += value * weight;
    weights += weight;
  }

  return weights ? sum / weights : null;
}

export const degreesToVector = (degrees) =>
  Number.isFinite(degrees)
    ? [
        Math.cos((degrees * Math.PI) / 180),
        Math.sin((degrees * Math.PI) / 180),
      ]
    : null;
