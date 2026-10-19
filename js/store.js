// Saved-plan backup (build guide §8). The storage object is passed in:
// window.localStorage in the browser, a fake in tests. Nothing here throws:
// a private window or blocked storage just means nothing is saved.

export function makeStore(storage) {
  return {
    get(key) {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage?.setItem(key, value);
      } catch {
        // Full or blocked: the URL still holds the plan.
      }
    },
    remove(key) {
      try {
        storage?.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

// The browser's localStorage, or nothing if even reading the property throws.
export function browserStore() {
  let storage = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return makeStore(storage);
}
