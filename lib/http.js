/**
 * The transport layer: one HTTP request with timeouts, bounded retries, and a
 * hard byte ceiling.
 *
 * Kept separate from the Feishu client so the retry and timeout policy has one
 * home, and so tests can inject a fake fetch instead of standing up a socket
 * per case.
 *
 * @module dsh-feishu/http
 */

/** HTTP statuses worth another attempt: rate limiting and transient server faults. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Cap on a single response body, so a hostile or runaway response cannot exhaust memory. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Build the structured abort error every layer recognises. */
function abortError() {
  const error = new Error('the Feishu request was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

/**
 * Recognize the abort error regardless of which library produced it.
 * @param error - the thrown value.
 * @returns whether it signals caller cancellation.
 */
export function isAbort(error) {
  return error !== null && typeof error === 'object' && (error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.code === 20);
}

/**
 * Sleep without leaking a timer when the caller aborts.
 * @param ms - milliseconds to wait.
 * @param signal - the caller's abort signal.
 * @param abortFactory - builds the abort error to reject with.
 * @returns a promise that settles when the delay elapses or the signal aborts.
 */
function delay(ms, signal, abortFactory) {
  return new Promise((resolve, reject) => {
    if (signal !== undefined && signal.aborted) {
      reject(abortFactory());
      return;
    }
    function onAbort() {
      clearTimeout(timer);
      reject(abortFactory());
    }
    const timer = setTimeout(() => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Read a response body with a byte ceiling.
 * @param response - the fetch response.
 * @returns the decoded text.
 */
async function readText(response) {
  const headerValue = response.headers !== undefined && response.headers !== null ? response.headers.get('content-length') : null;
  const declared = Number(headerValue);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('response body exceeds the ' + MAX_BODY_BYTES + ' byte limit');
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('response body exceeds the ' + MAX_BODY_BYTES + ' byte limit');
  return text;
}

/**
 * Perform one HTTP request, retrying transient failures.
 *
 * A Retry-After header is honoured when the server sends one; otherwise the
 * delay doubles from 300 ms. A caller abort is never retried.
 *
 * @param options - request facts.
 * @param options.url - absolute URL.
 * @param options.method - HTTP method.
 * @param options.headers - request headers.
 * @param options.body - a pre-encoded body, or undefined.
 * @param options.timeoutMs - per-attempt timeout.
 * @param options.maxRetries - additional attempts after the first.
 * @param options.signal - caller cancellation.
 * @param options.fetchImpl - fetch implementation; defaults to the global.
 * @param options.logger - optional logger for retry notices.
 * @returns the settled response facts.
 */
export async function httpRequest(options) {
  const fetchImpl = options.fetchImpl !== undefined ? options.fetchImpl : globalThis.fetch;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
  const logger = options.logger;
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal !== undefined) {
      if (options.signal.aborted) throw abortError();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response;
    let text;
    let failure;
    try {
      response = await fetchImpl(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
        redirect: 'manual',
      });
      text = await readText(response);
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      if (options.signal !== undefined) options.signal.removeEventListener('abort', onAbort);
    }

    if (options.signal !== undefined && options.signal.aborted) throw abortError();

    if (failure === undefined && response !== undefined) {
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries) {
        return { status: response.status, headers: response.headers, text };
      }
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = Number(retryAfterHeader);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 300 * Math.pow(2, attempt);
      if (logger !== undefined) logger.warn('feishu: HTTP ' + response.status + ' from ' + options.url + ', retrying in ' + waitMs + 'ms');
      await delay(waitMs, options.signal, abortError);
      attempt += 1;
      continue;
    }

    if (isAbort(failure) && options.signal !== undefined && options.signal.aborted) throw abortError();
    if (isAbort(failure) || (failure !== null && typeof failure === 'object' && failure.name === 'AbortError')) {
      failure = new Error('the Feishu request timed out after ' + options.timeoutMs + 'ms');
    }
    if (attempt >= maxRetries) throw failure;
    const waitMs = 300 * Math.pow(2, attempt);
    if (logger !== undefined) logger.warn('feishu: transport failure, retrying in ' + waitMs + 'ms: ' + String(failure && failure.message));
    await delay(waitMs, options.signal, abortError);
    attempt += 1;
  }
}
