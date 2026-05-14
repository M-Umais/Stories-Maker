// Safeguard against libraries or environments trying to overwrite window.fetch
// causing "TypeError: Cannot set property fetch of #<Window> which has only a getter"
if (typeof window !== 'undefined') {
  try {
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      // We shadow the prototype's getter-only fetch with a writable property on the window instance.
      // This prevents the TypeError when scripts try to assign to window.fetch.
      Object.defineProperty(window, 'fetch', {
        value: originalFetch,
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
  } catch (e) {
    // If we can't shadow it, we catch the error to at least not crash ourselves
  }
}
export {};
