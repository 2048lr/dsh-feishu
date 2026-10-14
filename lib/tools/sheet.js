/**
 * Feishu Sheets (电子表格) actions.
 *
 * Ranges use the A1 form Feishu expects, optionally prefixed with a sheet id
 * ("<sheetId>!A1:C10"). When the caller omits the sheet id, the first sheet of
 * the spreadsheet is used, which is what a model almost always means.
 *
 * @module dsh-feishu/tools/sheet
 */

import { defineTool, ok, IDENTITY_PARAMETER, stringParam } from './kit.js';

/** Cell values Feishu accepts in a write payload. */
const CELL_SCHEMA = { description: 'A cell value: string, number, boolean, or null. A cell may also be an array of rich-text segments or a formula string.' };

/**
 * Build a range string, filling in the first sheet id when none was given.
 * @param client - the Feishu client.
 * @param spreadsheetToken - the spreadsheet token.
 * @param range - the caller range.
 * @param identity - the requested identity.
 * @param signal - caller cancellation.
 * @returns the qualified range.
 */
async function qualifyRange(client, spreadsheetToken, range, identity, signal) {
  if (typeof range !== 'string' || range.trim().length === 0) throw new Error('a range such as "A1:D20" or "<sheetId>!A1:D20" is required');
  const trimmed = range.trim();
  if (trimmed.includes('!')) return trimmed;
  const data = await client.call({ method: 'GET', path: '/sheets/v3/spreadsheets/' + spreadsheetToken + '/sheets/query', identity, signal });
  const sheets = data !== null && typeof data === 'object' && Array.isArray(data.sheets) ? data.sheets : [];
  const first = sheets[0];
  if (first === undefined) throw new Error('this spreadsheet reports no sheets; pass an explicit "<sheetId>!A1:..." range');
  return first.sheet_id + '!' + trimmed;
}

/**
 * Build the Sheets tool.
 * @param deps - composition facts.
 * @param deps.client - the Feishu client.
 * @returns the tool definition.
 */
export function createSheetTool(deps) {
  const client = deps.client;

  return defineTool({
    name: 'feishu_sheet',
    timeoutMs: 180000,
    description: [
      'Create and edit Feishu spreadsheets (电子表格).',
      'Actions: create, get_info, list_sheets, read (values from a range), write (replace a range), append (add rows after the last non-empty row), add_sheet (add a new sheet/tab).',
      'A range is A1 notation, optionally sheet-qualified as "<sheetId>!A1:D20"; without a sheet id the first sheet is used.',
      'values is a rectangular array of arrays, one inner array per row.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['create', 'get_info', 'list_sheets', 'read', 'write', 'append', 'add_sheet'],
        description: 'The Sheets operation to perform.',
      },
      spreadsheetToken: stringParam('The spreadsheet token (shtcn...) for every action except create.'),
      title: stringParam('The new spreadsheet title (create) or new sheet title (add_sheet).'),
      folderToken: stringParam('Destination folder token for create. Defaults to the plugin configured folder.'),
      range: stringParam('The A1 range, for example "A1:D20" or "<sheetId>!A1:D20".'),
      values: {
        type: 'array',
        description: 'Rows to write: an array of row arrays, for example [["姓名","分数"],["Ada",95]].',
        items: { type: 'array', description: 'One row of cells.', items: CELL_SCHEMA },
      },
      sheetId: stringParam('An explicit sheet id for add_sheet placement or range qualification.'),
      index: { type: 'integer', description: 'Where to place a new sheet in the tab order (add_sheet).' },
      rowCount: { type: 'integer', description: 'Row count for a new sheet (add_sheet).' },
      columnCount: { type: 'integer', description: 'Column count for a new sheet (add_sheet).' },
      identity: IDENTITY_PARAMETER,
    },
    async execute(args, exec) {
      const signal = exec !== undefined && exec.signal !== undefined ? exec.signal : undefined;
      const identity = args.identity;
      const action = args.action;

      if (action === 'create') {
        const body = {};
        if (typeof args.title === 'string' && args.title.length > 0) body.title = args.title;
        const folderToken = typeof args.folderToken === 'string' && args.folderToken.length > 0 ? args.folderToken : client.config.defaultFolderToken;
        if (folderToken.length > 0) body.folder_token = folderToken;
        const data = await client.call({ method: 'POST', path: '/sheets/v3/spreadsheets', body, identity, signal });
        const sheet = data !== null && typeof data === 'object' && data.spreadsheet !== undefined ? data.spreadsheet : data;
        return ok({
          action,
          summary: 'created spreadsheet "' + (args.title !== undefined ? args.title : '') + '" (' + sheet.spreadsheet_token + ')',
          url: sheet.url,
          identity,
          data: sheet,
        });
      }

      if (action === 'get_info') {
        const data = await client.call({ method: 'GET', path: '/sheets/v3/spreadsheets/' + args.spreadsheetToken, identity, signal });
        const sheet = data !== null && typeof data === 'object' && data.spreadsheet !== undefined ? data.spreadsheet : data;
        return ok({ action, summary: 'read spreadsheet metadata', url: sheet.url, identity, data: sheet });
      }

      if (action === 'list_sheets') {
        const data = await client.call({ method: 'GET', path: '/sheets/v3/spreadsheets/' + args.spreadsheetToken + '/sheets/query', identity, signal });
        const sheets = data !== null && typeof data === 'object' && Array.isArray(data.sheets) ? data.sheets : [];
        return ok({ action, summary: 'spreadsheet has ' + sheets.length + ' sheet(s)', identity, data: { sheets } });
      }

      if (action === 'read') {
        const range = await qualifyRange(client, args.spreadsheetToken, args.range, identity, signal);
        const data = await client.call({
          method: 'GET',
          path: '/sheets/v2/spreadsheets/' + args.spreadsheetToken + '/values/' + range,
          query: { valueRenderOption: 'ToString' },
          identity,
          signal,
        });
        const valueRange = data !== null && typeof data === 'object' && data.valueRange !== undefined ? data.valueRange : data;
        const rows = valueRange !== null && typeof valueRange === 'object' && Array.isArray(valueRange.values) ? valueRange.values : [];
        return ok({
          action,
          summary: 'read ' + rows.length + ' row(s) from ' + range,
          identity,
          data: { range: valueRange.range, values: rows },
        });
      }

      if (action === 'write' || action === 'append') {
        if (!Array.isArray(args.values) || args.values.length === 0) throw new Error(action + ' needs a non-empty values array');
        const range = await qualifyRange(client, args.spreadsheetToken, args.range, identity, signal);
        const path = '/sheets/v2/spreadsheets/' + args.spreadsheetToken + (action === 'write' ? '/values' : '/values_append');
        const data = await client.call({
          method: action === 'write' ? 'PUT' : 'POST',
          path,
          body: { valueRange: { range, values: args.values } },
          identity,
          signal,
        });
        const updated = data !== null && typeof data === 'object' && data.updates !== undefined ? data.updates : data;
        return ok({
          action,
          summary: (action === 'write' ? 'wrote' : 'appended') + ' ' + args.values.length + ' row(s) at ' + range,
          identity,
          data: updated,
        });
      }

      if (action === 'add_sheet') {
        const properties = {};
        if (typeof args.title === 'string' && args.title.length > 0) properties.title = args.title;
        if (typeof args.index === 'number') properties.index = args.index;
        if (typeof args.rowCount === 'number') properties.row_count = args.rowCount;
        if (typeof args.columnCount === 'number') properties.column_count = args.columnCount;
        const data = await client.call({
          method: 'POST',
          path: '/sheets/v2/spreadsheets/' + args.spreadsheetToken + '/sheets_batch_update',
          body: { requests: [{ addSheet: { properties } }] },
          identity,
          signal,
        });
        const replies = data !== null && typeof data === 'object' && Array.isArray(data.replies) ? data.replies : [];
        const added = replies.length > 0 && replies[0].addSheet !== undefined ? replies[0].addSheet.properties : undefined;
        return ok({
          action,
          summary: 'added sheet ' + (added !== undefined && added.sheetId !== undefined ? added.sheetId : '') + ' to the spreadsheet',
          identity,
          data: { added, replies },
        });
      }

      throw new Error('unsupported Sheets action: ' + String(action));
    },
  });
}
