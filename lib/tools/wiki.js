/**
 * Feishu Wiki (知识库) actions.
 *
 * A wiki node is a pointer to a document, sheet, or Bitable app inside a
 * space. Creating one is the way to file agent-produced content into a team
 * knowledge base, so this module pairs with the doc, sheet, and Bitable tools:
 * create the object there, then create the node here with its token as the
 * node title target.
 *
 * @module dsh-feishu/tools/wiki
 */

import { defineTool, ok, IDENTITY_PARAMETER, stringParam } from './kit.js';

/** Object types a wiki node may wrap. */
const OBJ_TYPES = ['docx', 'doc', 'sheet', 'bitable', 'mindnote', 'file', 'slides'];

/**
 * Build the Wiki tool.
 * @param deps - composition facts.
 * @param deps.client - the Feishu client.
 * @returns the tool definition.
 */
export function createWikiTool(deps) {
  const client = deps.client;

  return defineTool({
    name: 'feishu_wiki',
    timeoutMs: 120000,
    description: [
      'Work with Feishu Wiki (知识库) spaces and nodes.',
      'Actions: list_spaces (every space this identity can see), list_nodes (children of a space or node), get_node (resolve a wiki token to the underlying document, sheet, or Bitable app), create_node (file a new or existing object into the space), move_node, update_title.',
      'get_node is the bridge in both directions: it turns a wiki URL token into the obj_token that the doc, sheet, and Bitable tools need.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list_spaces', 'list_nodes', 'get_node', 'create_node', 'move_node', 'update_title'],
        description: 'The Wiki operation to perform.',
      },
      spaceId: stringParam('The wiki space id, required by every action except get_node.'),
      nodeToken: stringParam('The wiki node token (wikcn...) for get_node, move_node, or update_title.'),
      token: stringParam('A wiki token to resolve with get_node; an alias for nodeToken.'),
      parentNodeToken: stringParam('The parent node token; omit to create or list at the space root.'),
      title: stringParam('The node title for create_node or update_title.'),
      objType: { type: 'string', enum: OBJ_TYPES, description: 'The type of object the node wraps (create_node).' },
      objToken: stringParam('The token of an existing document, sheet, or Bitable app to wrap in the new node.'),
      targetParentToken: stringParam('The destination parent node token for move_node.'),
      targetSpaceId: stringParam('The destination space id for move_node; defaults to the current space.'),
      pageSize: { type: 'integer', description: 'Items per page, 1-50.' },
      pageToken: stringParam('Pagination cursor returned by a previous page.'),
      autoPaginate: { type: 'boolean', description: 'Keep fetching pages (default true).' },
      identity: IDENTITY_PARAMETER,
    },
    async execute(args, exec) {
      const signal = exec !== undefined && exec.signal !== undefined ? exec.signal : undefined;
      const identity = args.identity;
      const action = args.action;

      if (action === 'list_spaces') {
        const page = await client.paginate({
          path: '/wiki/v2/spaces',
          itemsPath: 'items',
          pageSize: args.pageSize !== undefined && args.pageSize > 0 ? Math.min(args.pageSize, 50) : 20,
          pageToken: args.pageToken,
          autoPaginate: args.autoPaginate !== false,
          identity,
          signal,
        });
        const spaces = page.items.map((space) => ({ space_id: space.space_id, name: space.name, description: space.description, space_type: space.space_type }));
        return ok({ action, summary: 'found ' + spaces.length + ' wiki space(s)', identity, data: { spaces, pageToken: page.pageToken } });
      }

      if (action === 'list_nodes') {
        const page = await client.paginate({
          path: '/wiki/v2/spaces/' + args.spaceId + '/nodes',
          query: typeof args.parentNodeToken === 'string' && args.parentNodeToken.length > 0 ? { parent_node_token: args.parentNodeToken } : {},
          itemsPath: 'items',
          pageSize: args.pageSize !== undefined && args.pageSize > 0 ? Math.min(args.pageSize, 50) : 20,
          pageToken: args.pageToken,
          autoPaginate: args.autoPaginate !== false,
          identity,
          signal,
        });
        const nodes = page.items.map((node) => ({ node_token: node.node_token, obj_token: node.obj_token, obj_type: node.obj_type, title: node.title, has_child: node.has_child }));
        return ok({ action, summary: 'found ' + nodes.length + ' node(s)', identity, data: { nodes, pageToken: page.pageToken } });
      }

      if (action === 'get_node') {
        const token = typeof args.nodeToken === 'string' && args.nodeToken.length > 0 ? args.nodeToken : args.token;
        if (typeof token !== 'string' || token.length === 0) throw new Error('get_node needs a nodeToken (or token)');
        const data = await client.call({ method: 'GET', path: '/wiki/v2/spaces/get_node', query: { token }, identity, signal });
        const node = data !== null && typeof data === 'object' && data.node !== undefined ? data.node : data;
        return ok({
          action,
          summary: 'resolved node "' + node.title + '" to ' + node.obj_type + ' ' + node.obj_token,
          identity,
          data: node,
        });
      }

      if (action === 'create_node') {
        if (typeof args.title !== 'string' || args.title.length === 0) {
          if (typeof args.objToken !== 'string' || args.objToken.length === 0) throw new Error('create_node needs a title (or an objToken whose title can be reused)');
        }
        const body = { obj_type: typeof args.objType === 'string' && args.objType.length > 0 ? args.objType : 'docx', node_type: 'origin' };
        if (typeof args.title === 'string' && args.title.length > 0) body.title = args.title;
        if (typeof args.objToken === 'string' && args.objToken.length > 0) body.origin_node_token = args.objToken;
        if (typeof args.parentNodeToken === 'string' && args.parentNodeToken.length > 0) body.parent_node_token = args.parentNodeToken;
        const data = await client.call({ method: 'POST', path: '/wiki/v2/spaces/' + args.spaceId + '/nodes', body, identity, signal });
        const node = data !== null && typeof data === 'object' && data.node !== undefined ? data.node : data;
        return ok({
          action,
          summary: 'created wiki node "' + node.title + '" (' + node.node_token + ')',
          url: node.url,
          identity,
          data: node,
        });
      }

      if (action === 'move_node') {
        if (typeof args.nodeToken !== 'string' || args.nodeToken.length === 0) throw new Error('move_node needs a nodeToken');
        if (typeof args.targetParentToken !== 'string' || args.targetParentToken.length === 0) throw new Error('move_node needs a targetParentToken');
        const body = { target_parent_token: args.targetParentToken };
        if (typeof args.targetSpaceId === 'string' && args.targetSpaceId.length > 0) body.target_space_id = args.targetSpaceId;
        const data = await client.call({ method: 'POST', path: '/wiki/v2/spaces/' + args.spaceId + '/nodes/' + args.nodeToken + '/move', body, identity, signal });
        return ok({ action, summary: 'moved wiki node ' + args.nodeToken, identity, data });
      }

      if (action === 'update_title') {
        if (typeof args.nodeToken !== 'string' || args.nodeToken.length === 0) throw new Error('update_title needs a nodeToken');
        if (typeof args.title !== 'string' || args.title.length === 0) throw new Error('update_title needs a title');
        const data = await client.call({ method: 'POST', path: '/wiki/v2/spaces/' + args.spaceId + '/nodes/' + args.nodeToken + '/update_title', body: { title: args.title }, identity, signal });
        return ok({ action, summary: 'renamed wiki node to "' + args.title + '"', identity, data });
      }

      throw new Error('unsupported Wiki action: ' + String(action));
    },
  });
}
