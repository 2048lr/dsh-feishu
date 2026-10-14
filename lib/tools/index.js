/**
 * Tool assembly.
 *
 * Every builder is pure with respect to the host: it receives the client and
 * returns a definition. Registration, name prefixing, and activity recording
 * happen here, so a new domain module only has to export one builder.
 *
 * @module dsh-feishu/tools
 */

import { createAuthTool } from './auth.js';
import { createBitableTool } from './bitable.js';
import { createDocTool } from './docx.js';
import { createDriveTool } from './drive.js';
import { createMessageTool } from './im.js';
import { createRawTool } from './raw.js';
import { createSheetTool } from './sheet.js';
import { createWikiTool } from './wiki.js';

/** Every tool builder, in the order they are registered. */
export const TOOL_BUILDERS = [
  createAuthTool,
  createBitableTool,
  createDocTool,
  createSheetTool,
  createDriveTool,
  createWikiTool,
  createMessageTool,
  createRawTool,
];

/**
 * Apply a name prefix to a tool definition.
 * @param definition - the definition.
 * @param prefix - the configured prefix.
 * @param logger - optional logger for collisions.
 * @returns the renamed definition.
 */
function rename(definition, prefix, logger) {
  if (prefix === 'feishu_') return definition;
  if (!definition.name.startsWith('feishu_')) {
    if (logger !== undefined) logger.warn('feishu: tool ' + definition.name + ' does not use the standard prefix and will not be renamed');
    return definition;
  }
  return { ...definition, name: prefix + definition.name.slice('feishu_'.length) };
}

/**
 * Wrap a definition so every call lands in the activity ring.
 * @param definition - the definition.
 * @param activity - the activity ring.
 * @returns the wrapped definition.
 */
function traced(definition, activity) {
  if (activity === undefined) return definition;
  const inner = definition.execute;
  return {
    ...definition,
    async execute(args, exec) {
      const startedAt = Date.now();
      const action = args !== null && typeof args === 'object' && typeof args.action === 'string' ? args.action : definition.name;
      try {
        const value = await inner(args, exec);
        activity.record({
          at: startedAt,
          tool: definition.name,
          action,
          ok: value !== null && typeof value === 'object' ? value.ok !== false : true,
          summary: value !== null && typeof value === 'object' && typeof value.summary === 'string' ? value.summary : '',
          url: value !== null && typeof value === 'object' && typeof value.url === 'string' ? value.url : undefined,
          identity: value !== null && typeof value === 'object' && typeof value.identity === 'string' ? value.identity : undefined,
          ms: Date.now() - startedAt,
        });
        return value;
      } catch (error) {
        activity.record({
          at: startedAt,
          tool: definition.name,
          action,
          ok: false,
          summary: String(error !== null && error !== undefined && error.message !== undefined ? error.message : error),
          ms: Date.now() - startedAt,
        });
        throw error;
      }
    },
  };
}

/**
 * Build every Feishu tool.
 * @param deps - composition facts.
 * @param deps.client - the Feishu client.
 * @param deps.identity - the identity manager.
 * @param deps.config - normalized configuration.
 * @param deps.activity - the activity ring.
 * @param deps.resolveRedirectUri - returns the OAuth redirect URI to advertise.
 * @param deps.logger - optional logger.
 * @returns the definitions, already prefixed and traced.
 */
export function buildTools(deps) {
  return TOOL_BUILDERS.map((builder) => traced(rename(builder(deps), deps.config.toolPrefix, deps.logger), deps.activity));
}

/**
 * Register every Feishu tool on the host tool registry.
 * @param ctx - the Cordis context.
 * @param definitions - the definitions to register.
 * @param logger - optional logger.
 * @returns the disposers for every registration.
 */
export function registerTools(ctx, definitions, logger) {
  const disposers = [];
  for (const definition of definitions) {
    try {
      disposers.push(ctx.tools.register(definition));
    } catch (error) {
      if (logger !== undefined) logger.error('feishu: registering tool ' + definition.name + ' failed: ' + String(error && error.message));
      throw error;
    }
  }
  return disposers;
}
