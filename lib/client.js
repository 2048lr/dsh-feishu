/**
 * The Feishu open-platform client.
 *
 * One place owns the wire contract: the envelope (HTTP 200 with a non-zero
 * code is the normal failure shape), bearer-token selection, the single
 * automatic retry a stale token earns, multipart uploads, binary downloads,
 * and cursor pagination. Tool modules above this layer never build a URL or
 * inspect a status code.
 *
 * @module dsh-feishu/client
 */

import { httpRequest, isAbort } from './http.js';
import { FeishuError } from './errors.js';
import { TOKEN_EXPIRED_CODES } from './identity.js';

/** Methods the raw escape hatch accepts. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Append a query string to a path.
 * @param path - the API path.
 * @param query - an object of scalar values, or undefined.
 * @returns the path with its query string.
 */
function withQuery(path, query) {
  if (query === undefined || query === null) return path;
  const parts = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }
  return parts.length === 0 ? path : path + '?' + parts.join('&');
}

/** Render a body for an error message without dumping a whole payload. */
function preview(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text.slice(0, 400) : '';
  } catch {
    return '';
  }
}

/**
 * Build the client.
 *
 * @param options - composition facts.
 * @param options.config - normalized configuration.
 * @param options.identity - the identity manager.
 * @param options.logger - optional logger.
 * @param options.fetchImpl - fetch implementation for tests.
 * @returns the client.
 */
export function createFeishuClient(options) {
  const config = options.config;
  const identity = options.identity;
  const logger = options.logger;
  const fetchImpl = options.fetchImpl;

  /**
   * Perform one API call, unwrapping the Feishu envelope.
   *
   * @param spec - the call.
   * @param spec.method - HTTP method.
   * @param spec.path - API path, relative to the open-apis base.
   * @param spec.query - query parameters.
   * @param spec.body - JSON body.
   * @param spec.identity - the requested identity kind.
   * @param spec.signal - caller cancellation.
   * @param spec.binary - return the raw bytes instead of parsing JSON.
   * @param spec.acceptPlainData - return the whole envelope rather than its data.
   * @returns the business data, the envelope, or binary bytes.
   */
  async function call(spec) {
    const method = spec.method !== undefined ? spec.method : 'GET';
    const path = spec.path;
    const resolved = await identity.resolveIdentity(spec.identity, spec.signal);
    const url = config.apiBaseUrl + withQuery(path, spec.query);
    const headers = {
      authorization: 'Bearer ' + resolved.token,
      accept: spec.binary === true ? '*/*' : 'application/json',
    };
    let body;
    if (spec.body !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(spec.body);
    }

    let response;
    try {
      response = await httpRequest({
        url,
        method,
        headers,
        body,
        timeoutMs: config.requestTimeoutMs,
        maxRetries: config.maxRetries,
        signal: spec.signal,
        fetchImpl,
        logger,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new FeishuError('transport failure calling ' + path + ': ' + String(error && error.message), {
        path,
        cause: error,
      });
    }

    if (spec.binary === true) {
      if (response.status >= 400) {
        throw new FeishuError('downloading ' + path + ' failed with HTTP ' + response.status, {
          httpStatus: response.status,
          path,
          detail: response.text.slice(0, 300),
        });
      }
      return { bytes: Buffer.from(response.text, 'binary'), contentType: response.headers.get('content-type') };
    }

    let parsed;
    try {
      parsed = response.text.length > 0 ? JSON.parse(response.text) : {};
    } catch {
      throw new FeishuError('Feishu returned a non-JSON response for ' + path, {
        httpStatus: response.status,
        path,
        detail: response.text.slice(0, 300),
      });
    }

    const code = parsed !== null && typeof parsed === 'object' ? parsed.code : undefined;
    const ok = response.status < 400 && (typeof code !== 'number' || code === 0);
    if (ok) {
      if (spec.acceptPlainData === true) return parsed.data !== undefined ? parsed.data : parsed;
      return parsed !== null && typeof parsed === 'object' && parsed.data !== undefined ? parsed.data : parsed;
    }

    const message = parsed !== null && typeof parsed === 'object' && typeof parsed.msg === 'string' && parsed.msg.length > 0
      ? parsed.msg
      : 'Feishu returned HTTP ' + response.status + ' for ' + path;
    const error = new FeishuError(message, {
      code: typeof code === 'number' ? code : undefined,
      httpStatus: response.status,
      path,
      permissionViolations: parsed !== null && typeof parsed === 'object' ? parsed.permission_violations : undefined,
      detail: preview(parsed),
    });

    if (typeof code === 'number' && TOKEN_EXPIRED_CODES.has(code) && spec.retried !== true) {
      if (logger !== undefined) logger.warn('feishu: token rejected with code ' + code + '; refreshing and retrying ' + path);
      await renew(resolved.kind, spec.signal);
      return call({ ...spec, retried: true });
    }
    throw error;
  }

  /**
   * Renew the credential a call used, so one retry can succeed.
   * @param kind - the identity kind that failed.
   * @param signal - caller cancellation.
   * @returns nothing.
   */
  async function renew(kind, signal) {
    identity.reset();
    if (kind === 'user') {
      try {
        await identity.refreshUserToken(signal, true);
      } catch (error) {
        if (logger !== undefined) logger.warn('feishu: user token refresh after rejection failed: ' + String(error && error.message));
      }
    }
  }

  /**
   * Perform a multipart upload.
   * @param spec - the upload.
   * @param spec.path - API path.
   * @param spec.fields - scalar form fields.
   * @param spec.file - the file part: name, bytes, and content type.
   * @param spec.identity - the requested identity kind.
   * @param spec.signal - caller cancellation.
   * @returns the business data.
   */
  async function upload(spec) {
    const resolved = await identity.resolveIdentity(spec.identity, spec.signal);
    const url = config.apiBaseUrl + spec.path;
    const form = new FormData();
    for (const key of Object.keys(spec.fields !== undefined ? spec.fields : {})) {
      const value = spec.fields[key];
      if (value === undefined || value === null) continue;
      form.append(key, String(value));
    }
    const blob = new Blob([spec.file.bytes], { type: spec.file.contentType !== undefined ? spec.file.contentType : 'application/octet-stream' });
    form.append(spec.file.field !== undefined ? spec.file.field : 'file', blob, spec.file.name);

    let response;
    try {
      response = await httpRequest({
        url,
        method: 'POST',
        headers: { authorization: 'Bearer ' + resolved.token, accept: 'application/json' },
        body: form,
        timeoutMs: Math.max(config.requestTimeoutMs, 120000),
        maxRetries: config.maxRetries,
        signal: spec.signal,
        fetchImpl,
        logger,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new FeishuError('transport failure uploading to ' + spec.path + ': ' + String(error && error.message), { path: spec.path, cause: error });
    }

    let parsed;
    try {
      parsed = response.text.length > 0 ? JSON.parse(response.text) : {};
    } catch {
      throw new FeishuError('Feishu returned a non-JSON response for ' + spec.path, { httpStatus: response.status, path: spec.path, detail: response.text.slice(0, 300) });
    }
    const code = parsed !== null && typeof parsed === 'object' ? parsed.code : undefined;
    if (response.status >= 400 || (typeof code === 'number' && code !== 0)) {
      throw new FeishuError(parsed !== null && typeof parsed.msg === 'string' ? parsed.msg : 'upload failed with HTTP ' + response.status, {
        code: typeof code === 'number' ? code : undefined,
        httpStatus: response.status,
        path: spec.path,
        permissionViolations: parsed !== null && typeof parsed === 'object' ? parsed.permission_violations : undefined,
        detail: preview(parsed),
      });
    }
    return parsed !== null && typeof parsed === 'object' && parsed.data !== undefined ? parsed.data : parsed;
  }

  /**
   * Walk a cursor-paginated list endpoint.
   *
   * @param spec - the list call, using the same fields as {@link call} plus the
   *   container path that holds the items.
   * @param spec.itemsPath - dot path inside the data object holding the item array.
   * @param spec.maxItems - stop after this many items.
   * @param spec.pageSize - page size requested from Feishu.
   * @param spec.autoPaginate - when false, one page is returned.
   * @returns the collected items plus the last page facts.
   */
  async function paginate(spec) {
    const items = [];
    const maxItems = spec.maxItems !== undefined && spec.maxItems > 0 ? spec.maxItems : Number.MAX_SAFE_INTEGER;
    const pageSize = spec.pageSize !== undefined && spec.pageSize > 0 ? Math.min(spec.pageSize, config.maxRecordsPerPage) : 50;
    let pageToken = spec.pageToken;
    let pages = 0;
    let total;
    let lastData;
    for (;;) {
      const data = await call({
        method: spec.method !== undefined ? spec.method : 'GET',
        path: spec.path,
        query: { ...(spec.query !== undefined ? spec.query : {}), page_size: pageSize, ...(pageToken !== undefined && pageToken.length > 0 ? { page_token: pageToken } : {}) },
        body: spec.body,
        identity: spec.identity,
        signal: spec.signal,
      });
      lastData = data;
      pages += 1;
      const bucket = spec.itemsPath.split('.').reduce((node, key) => (node !== null && typeof node === 'object' ? node[key] : undefined), data);
      const list = Array.isArray(bucket) ? bucket : [];
      for (const entry of list) {
        if (items.length >= maxItems) break;
        items.push(entry);
      }
      if (typeof data.total === 'number') total = data.total;
      const hasMore = data.has_more === true && items.length < maxItems;
      const cursorToken = typeof data.page_token === 'string' ? data.page_token : data.next_page_token;
      pageToken = typeof cursorToken === 'string' ? cursorToken : undefined;
      if (spec.autoPaginate === false) break;
      if (!hasMore || pageToken === undefined || pageToken.length === 0) break;
    }
    return {
      items,
      total: total !== undefined ? total : items.length,
      pages,
      hasMore: lastData !== undefined && lastData.has_more === true,
      pageToken: lastData === undefined
        ? undefined
        : typeof lastData.page_token === 'string'
          ? lastData.page_token
          : typeof lastData.next_page_token === 'string'
            ? lastData.next_page_token
            : undefined,
      lastData,
    };
  }

  return {
    config,
    identity,
    call,
    upload,
    paginate,
    isAbort,
  };
}
