export function parseDem(buffer, offset = 0) {
  const headerLength = new DataView(buffer, offset).getUint32(0, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, offset + 4, headerLength)),
  );

  const cells = header.width * header.height;
  const base = offset + 4 + headerLength;

  return {
    ...header,
    elevation: new Int16Array(buffer, base, cells),
    aspect: new Uint8Array(buffer, base + cells * 2, cells),
    slope: new Uint8Array(buffer, base + cells * 3, cells),
    coast: new Uint8Array(buffer, base + cells * 4, cells),
  };
}
