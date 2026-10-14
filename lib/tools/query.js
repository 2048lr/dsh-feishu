/**
 * Aggregating queries over a Bitable, on the Base V3 API (the LiteQuery DSL).
 *
 * V1 can only page raw records, so any "group by / sum / top N" question costs a
 * full table scan and is computed in the agent's head. This endpoint does the
 * aggregation server-side and returns a small result, which is both cheaper and
 * correct for tables too large to page.
 *
 * The DSL names tables and fields rather than ids, which is what makes a query
 * readable. The convenience parameters below build exactly that DSL, and the raw
 * \`dsl\` argument is there for anything they do not express.
 *
 * @module dsh-feishu/tools/query
 */

import { defineTool, ok, IDENTITY_PARAMETER, jsonParam, stringParam } from './kit.js';

/** The aggregation functions the DSL accepts. */
export const AGGREGATIONS = ['sum', 'avg', 'min', 'max', 'count', 'count_all', 'distinct_count'];

/** The filter operators the DSL accepts. */
export const OPERATORS = ['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty', 'isGreater', 'isGreaterEqual', 'isLess', 'isLessEqual'];

/** Aggregations that only make sense on a number field. */
const NUMERIC_ONLY = ['sum', 'avg'];

/** Operators that take no value and must be sent an empty array. */
const VALUELESS = ['isEmpty', 'isNotEmpty'];

/** Build the table reference, preferring an explicit id when both are given. */
function tableRef(args) {
  if (typeof args.tableId === 'string' && args.tableId.length > 0) return { tableId: args.tableId };
  if (typeof args.tableName === 'string' && args.tableName.length > 0) return { tableName: args.tableName };
  return undefined;
}

/**
 * Assemble the LiteQuery DSL from the convenience parameters.
 * @param args - the tool arguments.
 * @returns the DSL object.
 */
export function buildDsl(args) {
  const table = tableRef(args);
  if (table === undefined) throw new Error('name the table with tableName or tableId, or pass a raw dsl');
  const dsl = { datasource: { type: 'table', table } };

  const dimensions = Array.isArray(args.dimensions) ? args.dimensions : [];
  if (dimensions.length > 0) {
    dsl.dimensions = dimensions.map((entry) => {
      if (typeof entry.fieldName !== 'string' || entry.fieldName.length === 0) throw new Error('every dimension needs a fieldName');
      const out = { field_name: entry.fieldName };
      if (typeof entry.alias === 'string' && entry.alias.length > 0) out.alias = entry.alias;
      return out;
    });
  }

  const measures = Array.isArray(args.measures) ? args.measures : [];
  if (measures.length > 0) {
    dsl.measures = measures.map((entry) => {
      if (typeof entry.fieldName !== 'string' || entry.fieldName.length === 0) throw new Error('every measure needs a fieldName (for count_all too, where it only has to be a real field)');
      const aggregation = typeof entry.aggregation === 'string' ? entry.aggregation.toLowerCase() : '';
      if (!AGGREGATIONS.includes(aggregation)) throw new Error('aggregation must be one of ' + AGGREGATIONS.join(', ') + ', got ' + JSON.stringify(entry.aggregation));
      const out = { field_name: entry.fieldName, aggregation };
      if (typeof entry.alias === 'string' && entry.alias.length > 0) out.alias = entry.alias;
      return out;
    });
  }

  if (dimensions.length === 0 && measures.length === 0) {
    throw new Error('provide at least one dimension or one measure');
  }

  if (args.filters !== undefined && args.filters !== null) {
    const conditions = Array.isArray(args.filters.conditions) ? args.filters.conditions : [];
    dsl.filters = {
      type: 1,
      conjunction: args.filters.conjunction === 'or' ? 'or' : 'and',
      conditions: conditions.map((entry) => {
        if (typeof entry.fieldName !== 'string' || entry.fieldName.length === 0) throw new Error('every filter condition needs a fieldName');
        if (!OPERATORS.includes(entry.operator)) throw new Error('filter operator must be one of ' + OPERATORS.join(', ') + ', got ' + JSON.stringify(entry.operator));
        const values = Array.isArray(entry.value) ? entry.value : entry.value === undefined || entry.value === null ? [] : [entry.value];
        if (VALUELESS.includes(entry.operator) && values.length > 0) {
          throw new Error(entry.operator + ' takes no value; pass an empty array');
        }
        if (!VALUELESS.includes(entry.operator) && values.length === 0) {
          throw new Error(entry.operator + ' needs a value; pass it as an array');
        }
        return { field_name: entry.fieldName, operator: entry.operator, value: values.map((value) => String(value)) };
      }),
    };
  }

  if (Array.isArray(args.sort) && args.sort.length > 0) {
    dsl.sort = args.sort.map((entry) => {
      if (typeof entry.fieldName !== 'string' || entry.fieldName.length === 0) throw new Error('every sort entry needs a fieldName (an output alias or an existing field name)');
      return { field_name: entry.fieldName, order: entry.order === 'desc' ? 'desc' : 'asc' };
    });
  }

  if (typeof args.limit === 'number' && Number.isInteger(args.limit) && args.limit > 0) {
    dsl.pagination = { limit: Math.min(args.limit, 5000) };
  }

  dsl.shaper = { format: 'flat' };
  return dsl;
}

/**
 * Flatten \`main_data\` from \`[{alias: {value: v}}]\` into \`[{alias: v}]\`.
 * @param mainData - the raw rows.
 * @returns the flattened rows.
 */
export function flattenRows(mainData) {
  if (!Array.isArray(mainData)) return [];
  return mainData.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
    const out = {};
    for (const key of Object.keys(row)) {
      const cell = row[key];
      out[key] = cell !== null && typeof cell === 'object' && !Array.isArray(cell) && Object.prototype.hasOwnProperty.call(cell, 'value') ? cell.value : cell;
    }
    return out;
  });
}

/**
 * Build the aggregating query tool.
 * @param deps - composition facts.
 * @param deps.client - the Feishu client.
 * @returns the tool definition.
 */
export function createQueryTool(deps) {
  const client = deps.client;

  return defineTool({
    name: 'feishu_query',
    timeoutMs: 120000,
    description: [
      'Run a grouped, aggregated query over a Feishu Bitable table, on the Base V3 API (LiteQuery).',
      'Use it for any "how many / total / average / top N / by category" question instead of paging raw records through feishu_bitable: the aggregation happens server-side and only the result comes back.',
      'Tables and fields are named, not addressed by id, and the names must match the table exactly.',
      'Group with dimensions, aggregate with measures (sum, avg, min, max, count, count_all, distinct_count; sum and avg need a number field), narrow with filters, order with sort, and cap rows with limit (max 5000).',
      'The reply carries rows (each keyed by field name or alias) plus the column order.',
      'For a query the convenience parameters cannot express, pass dsl: the raw LiteQuery object, which is forwarded unchanged.',
    ].join(' '),
    parameters: {
      baseToken: stringParam('The Bitable app token (bascn...), the same token the feishu_bitable tool uses. Required.'),
      tableName: stringParam('The table name to query, exactly as it appears in the base.'),
      tableId: stringParam('The table id (tbl...) instead of the table name; the id wins when both are given.'),
      dimensions: {
        type: 'array',
        description: 'GROUP BY fields: what to break the result down by. Each entry is {fieldName, alias?}.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fieldName: { type: 'string', required: true, description: 'The field name, exactly as it appears in the table.' },
            alias: stringParam('Output column name; must be unique across dimensions and measures.'),
          },
        },
      },
      measures: {
        type: 'array',
        description: 'Aggregated fields. Each entry is {fieldName, aggregation, alias?}.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fieldName: { type: 'string', required: true, description: 'The field name. For count_all this only has to name a real field; every row is counted regardless.' },
            aggregation: { type: 'string', required: true, enum: AGGREGATIONS, description: 'The aggregation to apply.' },
            alias: stringParam('Output column name; must be unique across dimensions and measures.'),
          },
        },
      },
      filters: {
        type: 'object',
        additionalProperties: false,
        description: 'WHERE clause.',
        properties: {
          conjunction: { type: 'string', enum: ['and', 'or'], description: 'How to combine the conditions (default and).' },
          conditions: {
            type: 'array',
            description: 'The conditions to apply.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fieldName: { type: 'string', required: true, description: 'The field name to test.' },
                operator: { type: 'string', required: true, enum: OPERATORS, description: 'The comparison. isEmpty and isNotEmpty take no value; every other operator needs exactly one.' },
                value: { type: 'array', items: { type: 'string' }, description: 'The comparison value as a one-element string array (numbers as strings, e.g. ["1000"]); empty for isEmpty and isNotEmpty.' },
              },
            },
          },
        },
      },
      sort: {
        type: 'array',
        description: 'ORDER BY entries: {fieldName, order}. The field may be a dimension, a measure alias, or an existing field name.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fieldName: { type: 'string', required: true, description: 'An output alias or a field name.' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default asc).' },
          },
        },
      },
      limit: { type: 'integer', description: 'Maximum rows to return, up to 5000.' },
      dsl: jsonParam('A raw LiteQuery object, forwarded unchanged. When present, the convenience parameters are ignored.'),
      identity: IDENTITY_PARAMETER,
    },
    async execute(args, exec) {
      const signal = exec !== undefined && exec.signal !== undefined ? exec.signal : undefined;
      const dsl = args.dsl !== undefined && args.dsl !== null ? args.dsl : buildDsl(args);
      if (dsl === null || typeof dsl !== 'object' || Array.isArray(dsl)) throw new Error('dsl must be a JSON object');
      const data = await client.call({
        method: 'POST',
        path: '/base/v3/bases/' + args.baseToken + '/data/query',
        body: dsl,
        identity: args.identity,
        signal,
      });
      const raw = data !== null && typeof data === 'object' && Array.isArray(data.main_data) ? data.main_data : [];
      const rows = flattenRows(raw);
      const columns = rows.length > 0 && rows[0] !== null && typeof rows[0] === 'object' && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : [];
      return ok({
        action: 'query',
        summary: 'query returned ' + rows.length + ' row(s)' + (columns.length > 0 ? ' over ' + columns.join(', ') : ''),
        identity: args.identity,
        data: { rows, columns, rowCount: rows.length, dsl },
      });
    },
  });
}
