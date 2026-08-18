function parseDem(buffer) {
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)),
  );

  const cells = header.width * header.height;
  const base = 4 + headerLength;

  return {
    ...header,
    elevation: new Int16Array(buffer, base, cells),
    aspect: new Uint8Array(buffer, base + cells * 2, cells),
    slope: new Uint8Array(buffer, base + cells * 3, cells),
  };
}

const cache = new Map();

export async function fetchDem(url) {
  if (cache.has(url)) return cache.get(url);

  const promise = fetch(url)
    .then((res) => res.arrayBuffer())
    .then(parseDem);

  cache.set(url, promise);
  return promise;
}
