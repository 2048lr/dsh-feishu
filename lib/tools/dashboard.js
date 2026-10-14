/**
 * Multi-dimensional-table dashboards and charts, on the Base V3 API.
 *
 * This is the part of the Bitable surface that has no V1 equivalent. V1 can read
 * and write records; it cannot describe a chart. V3 exposes dashboards and their
 * blocks, and a block's appearance is entirely a \`data_config\` object that names
 * a table and its fields - the same "table name + field name, never an id" model
 * the aggregating query API uses.
 *
 * The \`data_config\` shape is large, so it is validated only far enough to turn
 * the two mistakes that are actually common into actionable errors: a text block
 * with no text, and a chart block with no metric. Everything else is passed
 * through as written, because the server's own validation messages are better
 * than anything guessed here.
 *
 * @module dsh-feishu/tools/dashboard
 */

import { defineTool, ok, IDENTITY_PARAMETER, jsonParam, stringParam } from './kit.js';

/** Block types the dashboard accepts, with their Chinese names for the description. */
export const BLOCK_TYPES = [
  ['column', '柱状图'],
  ['bar', '条形图'],
  ['line', '折线图'],
  ['pie', '饼图'],
  ['ring', '环形图'],
  ['area', '面积图'],
  ['combo', '组合图'],
  ['scatter', '散点图'],
  ['funnel', '漏斗图'],
  ['wordCloud', '词云'],
  ['radar', '雷达图'],
  ['ranking', '排行榜'],
  ['statistics', '指标卡'],
  ['nps', 'NPS 图'],
  ['text', '文本'],
];

/** Block types that draw a metric rather than free text. */
const DATA_BLOCK_TYPES = new Set(BLOCK_TYPES.map(([name]) => name).filter((name) => name !== 'text'));

/** Metrics a series may roll up. */
const ROLLUPS = ['SUM', 'MAX', 'MIN', 'AVERAGE'];

/**
 * Validate a \`data_config\` the way a careful author would.
 * @param type - the block type.
 * @param dataConfig - the caller's data_config.
 * @returns a list of problems, empty when the shape looks usable.
 */
export function validateDataConfig(type, dataConfig) {
  const problems = [];
  if (dataConfig === undefined || dataConfig === null || typeof dataConfig !== 'object' || Array.isArray(dataConfig)) {
    if (type === 'text') problems.push('a text block needs dataConfig {"text": "markdown"}');
    else problems.push('this block type needs a dataConfig object');
    return problems;
  }
  if (type === 'text') {
    if (typeof dataConfig.text !== 'string' || dataConfig.text.length === 0) problems.push('a text block needs dataConfig.text (Markdown)');
    return problems;
  }
  if (!DATA_BLOCK_TYPES.has(type)) return problems;
  if (typeof dataConfig.table_name !== 'string' || dataConfig.table_name.length === 0) {
    problems.push('dataConfig.table_name is required: the chart reads a table by name');
  }
  const hasSeries = Array.isArray(dataConfig.series) && dataConfig.series.length > 0;
  if (!hasSeries && dataConfig.count_all !== true) {
    problems.push('dataConfig needs either series[{field_name, rollup}] or count_all:true - a chart with no metric draws nothing');
  }
  if (hasSeries) {
    for (let index = 0; index < dataConfig.series.length; index += 1) {
      const entry = dataConfig.series[index];
      if (entry === null || typeof entry !== 'object' || typeof entry.field_name !== 'string' || entry.field_name.length === 0) {
        problems.push('dataConfig.series[' + index + '].field_name is required');
        continue;
      }
      if (typeof entry.rollup !== 'string' || !ROLLUPS.includes(entry.rollup.toUpperCase())) {
        problems.push('dataConfig.series[' + index + '].rollup must be one of ' + ROLLUPS.join(', '));
      }
    }
  }
  if (type === 'ranking') {
    if (!Array.isArray(dataConfig.group_by) || dataConfig.group_by.length !== 1) problems.push('a ranking block takes exactly one group_by entry');
    if (hasSeries && dataConfig.series.length !== 1) problems.push('a ranking block takes exactly one series entry');
  }
  return problems;
}

/**
 * Validate an optional block position.
 * @param position - the caller's position object.
 * @returns a list of problems, empty when the position is usable or absent.
 */
export function validatePosition(position) {
  if (position === undefined || position === null) return [];
  if (typeof position !== 'object' || Array.isArray(position)) return ['position must be an object like {"x":0,"y":0,"w":6,"h":4}'];
  const problems = [];
  for (const key of ['x', 'y', 'w', 'h']) {
    if (typeof position[key] !== 'number' || !Number.isFinite(position[key])) problems.push('position.' + key + ' must be a number (all of x, y, w, h are required)');
  }
  return problems;
}

/**
 * Build the dashboard tool.
 * @param deps - composition facts.
 * @param deps.client - the Feishu client.
 * @returns the tool definition.
 */
export function createDashboardTool(deps) {
  const client = deps.client;
  const typeList = BLOCK_TYPES.map(([name, label]) => name + '(' + label + ')').join(', ');

  return defineTool({
    name: 'feishu_dashboard',
    timeoutMs: 180000,
    description: [
      'Create and edit dashboards and chart blocks inside a Feishu Bitable, using the Base V3 API (the part of 多维表格 that has no V1 equivalent).',
      'Actions: list_dashboards, create_dashboard, get_dashboard, update_dashboard, delete_dashboard, list_blocks, create_block, get_block, update_block, delete_block, get_block_data.',
      'Block types: ' + typeList + '.',
      'A chart block is described entirely by dataConfig, which names a table and its fields (never ids): {table_name, series:[{field_name, rollup:SUM|MAX|MIN|AVERAGE}] or count_all:true, group_by:[{field_name, mode:integrated|enumerated, sort:{type:group|value|view, order:asc|desc}}], filter:{conjunction:and|or, conditions:[{field_name, operator, value}]}, limit_size (ranking only), number_format}.',
      'A text block takes dataConfig {text: "markdown"} and needs no table.',
      'Omit position to let the server lay the block out; otherwise pass {x,y,w,h} on the dashboard 12-column grid.',
      'Create dashboards and blocks sequentially, and read a chart back with get_block_data, which returns the computed numbers rather than the configuration.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list_dashboards', 'create_dashboard', 'get_dashboard', 'update_dashboard', 'delete_dashboard', 'list_blocks', 'create_block', 'get_block', 'update_block', 'delete_block', 'get_block_data'],
        description: 'The dashboard operation to perform.',
      },
      baseToken: stringParam('The Bitable app token (bascn...), the same token the feishu_bitable tool uses. Required.'),
      dashboardId: stringParam('The dashboard id (blk...) for every block action and for get/update/delete_dashboard.'),
      blockId: stringParam('The block id (cht...) for get_block, update_block, delete_block, and get_block_data.'),
      name: stringParam('The dashboard name (create/update_dashboard) or block name (create/update_block).'),
      themeStyle: stringParam('Dashboard theme style; omit for the platform default.'),
      type: { type: 'string', enum: BLOCK_TYPES.map(([name]) => name), description: 'The chart type for create_block.' },
      dataConfig: jsonParam('The data_config object. See the tool description for its shape; it is passed through after a light check.'),
      position: jsonParam('Optional block placement and size on the 12-column grid: {x, y, w, h}, all four numeric. Omit for server auto-layout.'),
      pageSize: { type: 'integer', description: 'Items per page for list_dashboards and list_blocks.' },
      pageToken: stringParam('Pagination cursor returned by a previous page.'),
      identity: IDENTITY_PARAMETER,
    },
    async execute(args, exec) {
      const signal = exec !== undefined && exec.signal !== undefined ? exec.signal : undefined;
      const identity = args.identity;
      const action = args.action;
      const base = '/base/v3/bases/' + args.baseToken;
      const dashboard = base + '/dashboards/' + args.dashboardId;

      if (action === 'list_dashboards') {
        const page = await client.paginate({
          path: base + '/dashboards',
          itemsPath: 'items',
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          autoPaginate: true,
          identity,
          signal,
        });
        const dashboards = page.items.map((entry) => ({ dashboard_id: entry.dashboard_id, name: entry.name, theme: entry.theme }));
        return ok({
          action,
          summary: 'this base has ' + dashboards.length + ' dashboard(s)',
          identity,
          data: { dashboards, total: page.total, pageToken: page.pageToken, hasMore: page.hasMore },
        });
      }

      if (action === 'create_dashboard') {
        if (typeof args.name !== 'string' || args.name.trim().length === 0) throw new Error('create_dashboard needs a name');
        const body = { name: args.name.trim() };
        if (typeof args.themeStyle === 'string' && args.themeStyle.length > 0) body.theme = { theme_style: args.themeStyle };
        const data = await client.call({ method: 'POST', path: base + '/dashboards', body, identity, signal });
        return ok({
          action,
          summary: 'created dashboard "' + (data.name !== undefined ? data.name : body.name) + '" (' + data.dashboard_id + ')',
          identity,
          data,
        });
      }

      if (action === 'get_dashboard') {
        requireParam(args.dashboardId, 'get_dashboard needs a dashboardId');
        const data = await client.call({ method: 'GET', path: dashboard, identity, signal });
        return ok({ action, summary: 'read dashboard "' + data.name + '"', identity, data });
      }

      if (action === 'update_dashboard') {
        requireParam(args.dashboardId, 'update_dashboard needs a dashboardId');
        const body = {};
        if (typeof args.name === 'string' && args.name.length > 0) body.name = args.name;
        if (typeof args.themeStyle === 'string' && args.themeStyle.length > 0) body.theme = { theme_style: args.themeStyle };
        if (Object.keys(body).length === 0) throw new Error('update_dashboard needs a name or a themeStyle to change');
        const data = await client.call({ method: 'PATCH', path: dashboard, body, identity, signal });
        return ok({ action, summary: 'updated dashboard ' + args.dashboardId, identity, data });
      }

      if (action === 'delete_dashboard') {
        requireParam(args.dashboardId, 'delete_dashboard needs a dashboardId');
        const data = await client.call({ method: 'DELETE', path: dashboard, identity, signal });
        return ok({ action, summary: 'deleted dashboard ' + args.dashboardId, identity, data });
      }

      if (action === 'list_blocks') {
        requireParam(args.dashboardId, 'list_blocks needs a dashboardId');
        const page = await client.paginate({
          path: dashboard + '/blocks',
          itemsPath: 'items',
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          autoPaginate: true,
          identity,
          signal,
        });
        const blocks = page.items.map((entry) => ({ block_id: entry.block_id, name: entry.name, type: entry.type, position: entry.position }));
        return ok({
          action,
          summary: 'dashboard has ' + blocks.length + ' block(s)',
          identity,
          data: { blocks, total: page.total, pageToken: page.pageToken, hasMore: page.hasMore },
        });
      }

      if (action === 'create_block') {
        requireParam(args.dashboardId, 'create_block needs a dashboardId');
        if (typeof args.name !== 'string' || args.name.trim().length === 0) throw new Error('create_block needs a name');
        if (typeof args.type !== 'string' || args.type.length === 0) throw new Error('create_block needs a type, one of ' + BLOCK_TYPES.map(([entry]) => entry).join(', '));
        const problems = validateDataConfig(args.type, args.dataConfig).concat(validatePosition(args.position));
        if (problems.length > 0) throw new Error('invalid dataConfig or position: ' + problems.join('; '));
        const body = { name: args.name.trim(), type: args.type };
        if (args.dataConfig !== undefined) body.data_config = args.dataConfig;
        if (args.position !== undefined) body.position = args.position;
        const data = await client.call({ method: 'POST', path: dashboard + '/blocks', body, identity, signal });
        return ok({
          action,
          summary: 'created ' + args.type + ' block "' + (data.name !== undefined ? data.name : body.name) + '" (' + data.block_id + ')',
          identity,
          data,
        });
      }

      if (action === 'get_block') {
        requireParam(args.dashboardId, 'get_block needs a dashboardId');
        requireParam(args.blockId, 'get_block needs a blockId');
        const data = await client.call({ method: 'GET', path: dashboard + '/blocks/' + args.blockId, identity, signal });
        return ok({ action, summary: 'read block "' + data.name + '" (' + data.type + ')', identity, data });
      }

      if (action === 'update_block') {
        requireParam(args.dashboardId, 'update_block needs a dashboardId');
        requireParam(args.blockId, 'update_block needs a blockId');
        const body = {};
        if (typeof args.name === 'string' && args.name.length > 0) body.name = args.name;
        if (args.dataConfig !== undefined) {
          const problems = validateDataConfig(typeof args.type === 'string' && args.type.length > 0 ? args.type : 'column', args.dataConfig)
            .filter((problem) => !problem.includes('needs a dataConfig object'));
          if (problems.length > 0) throw new Error('invalid dataConfig: ' + problems.join('; '));
          body.data_config = args.dataConfig;
        }
        if (args.position !== undefined) {
          const problems = validatePosition(args.position);
          if (problems.length > 0) throw new Error('invalid position: ' + problems.join('; '));
          body.position = args.position;
        }
        if (Object.keys(body).length === 0) throw new Error('update_block needs a name, a dataConfig, or a position to change');
        const data = await client.call({ method: 'PATCH', path: dashboard + '/blocks/' + args.blockId, body, identity, signal });
        return ok({ action, summary: 'updated block ' + args.blockId, identity, data });
      }

      if (action === 'delete_block') {
        requireParam(args.dashboardId, 'delete_block needs a dashboardId');
        requireParam(args.blockId, 'delete_block needs a blockId');
        const data = await client.call({ method: 'DELETE', path: dashboard + '/blocks/' + args.blockId, identity, signal });
        return ok({ action, summary: 'deleted block ' + args.blockId, identity, data });
      }

      if (action === 'get_block_data') {
        requireParam(args.blockId, 'get_block_data needs a blockId');
        // The computed-data path carries no dashboard id, by design.
        const data = await client.call({ method: 'GET', path: base + '/dashboards/blocks/' + args.blockId + '/data', identity, signal });
        return ok({ action, summary: 'read the computed data of block ' + args.blockId, identity, data });
      }

      throw new Error('unsupported dashboard action: ' + String(action));
    },
  });
}

/**
 * Fail with a clear message when a required id is missing.
 * @param value - the candidate value.
 * @param message - the message to throw.
 */
function requireParam(value, message) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
}
