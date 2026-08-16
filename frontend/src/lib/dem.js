import { parseDem } from "../shared/demFormat";

const cache = new Map();

export async function fetchDem(url) {
  if (cache.has(url)) return cache.get(url);

  const promise = fetch(url)
    .then((res) => res.arrayBuffer())
    .then(parseDem);

  cache.set(url, promise);
  return promise;
}
