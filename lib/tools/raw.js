/**
 * The escape hatch.
 *
 * The curated tools cover the surfaces an agent reaches for constantly, but the
 * Feishu open platform is enormous and the release cadence is faster than any
 * wrapper. This tool exposes one authenticated call against any documented
 * path, with the same envelope handling, token selection, retry, and error
 * mapping as the curated tools - so a capability the wrapper does not model is
 * a call away rather than a plugin release away.
 *
 * @module dsh-feishu/tools/raw
 */

import { defineTool, ok, IDENTITY_PARAMETER, jsonParam, stringParam } from './kit.js';
import { HTTP_METHODS } from '../client.js';

/**
 * Build the raw API tool.
 * @param deps - composition facts.
 * @param deps.client - the Feishu client.
 * @returns the tool definition.
 */
export function createRawTool(deps) {
  const client = deps.client;

  return defineTool({
    name: 'feishu_api',
    timeoutMs: 180000,
    description: [
      'Call any Feishu open-platform API path directly.',
      'Use this for endpoints the curated feishu_* tools do not cover, for example /contact/v3/users/{user_id}, /calendar/v4/calendars, /task/v2/tasks, or /approval/v4/instances.',
      'path is relative to the open-apis base and must start with a slash, for example "/calendar/v4/calendars". query holds query parameters; body is the JSON request body. Path parameters are written into the path itself.',
      'The response envelope is unwrapped: the returned data is the API data object. Prefer a curated tool when one exists, because it validates arguments and explains failures better.',
    ].join(' '),
    parameters: {
      method: { type: 'string', required: true, enum: HTTP_METHODS, description: 'The HTTP method.' },
      path: stringParam('The API path beginning with a slash, for example "/bitable/v1/apps".'),
      query: jsonParam('Query parameters as an object of scalars, for example {page_size: 20, user_id_type: "open_id"}.'),
      body: jsonParam('The JSON request body for POST, PUT, and PATCH.'),
      identity: IDENTITY_PARAMETER,
    },
    async execute(args, exec) {
      const signal = exec !== undefined && exec.signal !== undefined ? exec.signal : undefined;
      const path = args.path;
      if (typeof path !== 'string' || path.length === 0 || path.charAt(0) !== '/') {
        throw new Error('path must be a string with a leading slash, for example "/contact/v3/users/ou_xxx"');
      }
      if (path.includes('..')) throw new Error('path must not contain ".."');
      const query = {};
      if (args.query !== undefined && args.query !== null && typeof args.query === 'object' && !Array.isArray(args.query)) {
        for (const key of Object.keys(args.query)) {
          const value = args.query[key];
          if (value === undefined || value === null) continue;
          query[key] = typeof value === 'object' ? JSON.stringify(value) : value;
        }
      }
      const data = await client.call({
        method: args.method,
        path,
        query,
        body: args.body,
        identity: args.identity,
        signal,
        acceptPlainData: true,
      });
      return ok({
        action: args.method + ' ' + path,
        summary: 'called ' + args.method + ' ' + path,
        identity: args.identity,
        data,
      });
    },
  });
}
