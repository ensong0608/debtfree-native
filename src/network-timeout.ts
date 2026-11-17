/** Bound each request, including auth, without retrying writes of uncertain outcome. */
export function createBoundedFetch(fetcher: typeof fetch, milliseconds = 15000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const callerSignal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
    const abort = () => controller.abort();
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, milliseconds);
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
    }
  };
}
