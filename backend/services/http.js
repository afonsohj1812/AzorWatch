const ATTEMPTS = 4;
const BACKOFF_MS = 2000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchRetrying(url, label) {
  let last = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res = null;

    try {
      res = await fetch(url);
    } catch (err) {
      last = err;
    }

    if (res?.ok) return res;

    if (res) {
      last = new Error(`${label} HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) throw last;
    }

    if (attempt < ATTEMPTS) {
      console.warn(
        `${label} attempt ${attempt} failed (${last.message}), retrying`,
      );
      await wait(BACKOFF_MS * attempt);
    }
  }

  throw last;
}
