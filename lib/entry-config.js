/**
 * Read and write this plugin's own loader entry in the profile patch file.
 *
 * This is what makes a visual settings page possible without the harness
 * settings service: the profile's `cordis.patch.yml` is hot-reloaded, so
 * rewriting this plugin's entry changes the live configuration.
 *
 * The design is deliberately conservative, because the file being edited belongs
 * to the user and a malformed patch can break the whole profile:
 *
 *  - only a path shaped like `.../profiles/<name>/cordis.patch.yml` is accepted;
 *  - only the plugin's own entry block is replaced, byte for byte, and only when
 *    it can be located unambiguously (managed markers first, then a structural
 *    scan for the entry that names this plugin);
 *  - keys the form does not know are carried over verbatim rather than dropped;
 *  - the write is atomic (temp file plus rename) and keeps one backup.
 *
 * The YAML handling is line-oriented and supports exactly the flat scalar shape
 * this plugin's configuration has. It is not a general YAML parser and does not
 * pretend to be one.
 *
 * @module dsh-feishu/entry-config
 */

import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Markers the installer writes around the managed block. */
export const MARKERS = {
  start: '# >>> dsh-feishu',
  end: '# <<< dsh-feishu',
};

/** The loader entry id and package name this module manages. */
export const ENTRY = { id: 'feishu', name: 'dsh-feishu' };

/** The patch file name the harness watches. */
export const PATCH_FILENAME = 'cordis.patch.yml';

/**
 * The configuration keys the settings page owns.
 *
 * A key outside this list is left byte-for-byte untouched in the file and
 * reported as unmanaged, so adding a field to the plugin without teaching the
 * page about it never destroys a hand-written value.
 */
export const KNOWN_KEYS = [
  'appId',
  'appSecretRef',
  'brand',
  'apiBaseUrl',
  'accountsBaseUrl',
  'defaultFolderToken',
  'defaultIdentity',
  'toolPrefix',
  'requestTimeoutMs',
  'maxRetries',
  'enableTools',
  'enableOAuth',
  'enableUi',
  'oauthRedirectUri',
  'oauthScopes',
  'registerSystemPrompt',
  'maxRecordsPerPage',
  'activityLogSize',
  'patchFilePath',
];

/**
 * Report whether a path is a profile patch file this module is willing to write.
 * @param path - the candidate path.
 * @returns whether the shape matches.
 */
export function isProfilePatchPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const normalized = path.split(sep).join('/');
  return new RegExp('/profiles/[^/]+/' + PATCH_FILENAME.replace('.', '\\.') + '$', 'u').test(normalized);
}

/** How far above an anchor directory to look for a profile. */
const ANCESTOR_DEPTH = 6;

/**
 * Turn an anchor into a directory, accepting a path or a file URL.
 * @param anchor - a filesystem path or a file: URL.
 * @returns the directory, or undefined when the anchor is unusable.
 */
function anchorDirectory(anchor) {
  if (typeof anchor !== 'string' || anchor.length === 0) return undefined;
  try {
    return dirname(anchor.startsWith('file:') ? fileURLToPath(anchor) : anchor);
  } catch {
    return undefined;
  }
}

/**
 * List every place the profile patch file could be, most trustworthy first.
 *
 * The environment is not enough on its own: the harness synthesizes its DSH_*
 * variables per shell execution for child processes, so a plugin running inside
 * the host process does not necessarily see DSH_PROFILE_DIR. The fallback that
 * actually holds is the plugin's own location - it is installed at
 * <profile>/node_modules/dsh-feishu/lib/, so walking up from the module finds
 * the profile - and every candidate is checked against the profile path shape
 * before it is trusted.
 *
 * @param config - the normalized plugin configuration.
 * @param options - lookup facts.
 * @param options.env - the environment to consult; defaults to the process environment.
 * @param options.baseUrl - the Cordis context base URL, when it is a file URL.
 * @returns the candidate paths, de-duplicated and ordered.
 */
export function patchFileCandidates(config, options) {
  const settings = options !== undefined ? options : {};
  const env = settings.env !== undefined ? settings.env : typeof process !== 'undefined' && process.env !== undefined ? process.env : {};
  const candidates = [];

  if (config !== undefined && typeof config.patchFilePath === 'string' && config.patchFilePath.length > 0) {
    candidates.push(config.patchFilePath);
  }
  if (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR.length > 0) {
    candidates.push(join(env.DSH_PROFILE_DIR, PATCH_FILENAME));
  }
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0) {
    candidates.push(join(env.DSH_HOME, 'profiles', typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE.length > 0 ? env.DSH_PROFILE : 'desktop', PATCH_FILENAME));
  }

  const anchors = [settings.baseUrl, settings.moduleUrl, import.meta.url];
  for (const anchor of anchors) {
    let directory = anchorDirectory(anchor);
    for (let depth = 0; directory !== undefined && depth < ANCESTOR_DEPTH; depth += 1) {
      candidates.push(join(directory, PATCH_FILENAME));
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  const seen = new Set();
  const ordered = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }
  return ordered;
}

/**
 * Resolve the patch file to edit, preferring a candidate that exists.
 * @param config - the normalized plugin configuration.
 * @param options - lookup facts, as for {@link patchFileCandidates}.
 * @returns the absolute path, or undefined when no candidate is a real profile patch file.
 */
export function resolvePatchFile(config, options) {
  const candidates = patchFileCandidates(config, options);
  for (const candidate of candidates) {
    if (!isProfilePatchPath(candidate)) continue;
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* an unreadable candidate is simply not the one */
    }
  }
  return undefined;
}

/**
 * Strip a trailing YAML comment that is not inside quotes.
 * @param value - the raw scalar text.
 * @returns the value and the comment, if any.
 */
function splitComment(value) {
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote.length > 0) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || value[index - 1] === ' ' || value[index - 1] === '\t')) {
      return { value: value.slice(0, index), comment: value.slice(index) };
    }
  }
  return { value, comment: '' };
}

/**
 * Parse one YAML scalar in the flat shape this plugin uses.
 * @param raw - the raw scalar text.
 * @returns the parsed value.
 */
export function parseScalar(raw) {
  const text = splitComment(typeof raw === 'string' ? raw : String(raw)).value.trim();
  if (text.length === 0) return '';
  if (text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((entry) => parseScalar(entry));
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).split("''").join("'");
  }
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (/^-?[0-9]+(\.[0-9]+)?$/u.test(text)) return Number(text);
  return text;
}

/**
 * Serialize one scalar for the patch file.
 * @param value - the value.
 * @returns the YAML text.
 */
export function renderScalar(value) {
  if (value === null || value === undefined) return "''";
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[' + value.map((entry) => renderScalar(entry)).join(', ') + ']';
  }
  const text = String(value);
  if (text.length === 0) return "''";
  return "'" + text.split("'").join("''") + "'";
}

/**
 * Locate the plugin's entry block in the patch file.
 * @param lines - the patch file split into lines.
 * @returns the block bounds, or undefined when it cannot be located.
 */
function locateBlock(lines) {
  // Preferred: the managed markers.
  const start = lines.findIndex((line) => line.startsWith(MARKERS.start));
  if (start !== -1) {
    const end = lines.findIndex((line, index) => index > start && line.startsWith(MARKERS.end));
    if (end !== -1) return { start, end, mode: 'markers' };
  }

  // Fallback: a hand-written entry that names this plugin.
  const nameIndex = lines.findIndex((line) => new RegExp('^\\s*name:\\s*[\'"]?' + ENTRY.name + '[\'"]?\\s*$', 'u').test(line));
  if (nameIndex === -1) return undefined;
  let entryStart = nameIndex;
  while (entryStart > 0 && !/^-\s/u.test(lines[entryStart])) entryStart -= 1;
  if (!/^-\s/u.test(lines[entryStart])) return undefined;
  let entryEnd = entryStart + 1;
  while (entryEnd < lines.length && !/^-\s/u.test(lines[entryEnd]) && !lines[entryEnd].startsWith(MARKERS.start)) entryEnd += 1;
  return { start: entryStart, end: entryEnd - 1, mode: 'scan' };
}

/**
 * Read the configuration values from this plugin's entry block.
 *
 * Managed keys are parsed into values; every other configuration line is kept
 * verbatim so the writer can put it back untouched.
 *
 * @param text - the patch file contents.
 * @param knownKeys - the keys the caller manages; defaults to {@link KNOWN_KEYS}.
 * @returns the parsed values, the lines carried over verbatim, and the block bounds.
 */
export function readEntry(text, knownKeys) {
  const managed = new Set(knownKeys !== undefined ? knownKeys : KNOWN_KEYS);
  const lines = String(text).split(/\r?\n/u);
  const block = locateBlock(lines);
  if (block === undefined) return { found: false, values: {}, extraLines: [], lines, unmanaged: [] };
  const values = {};
  const extraLines = [];
  const unmanaged = [];
  let inConfig = false;
  let configIndent = -1;
  for (let index = block.start; index <= block.end; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (/^config:\s*$/u.test(trimmed)) {
      inConfig = true;
      configIndent = indent;
      continue;
    }
    if (!inConfig) continue;
    if (indent <= configIndent) {
      inConfig = false;
      continue;
    }
    const match = new RegExp('^([A-Za-z_][A-Za-z0-9_]*):\\s*(.*)$', 'u').exec(trimmed);
    if (match === null) {
      extraLines.push(line);
      continue;
    }
    if (!managed.has(match[1])) {
      extraLines.push(line);
      unmanaged.push(match[1]);
      continue;
    }
    values[match[1]] = parseScalar(match[2]);
  }
  return { found: true, values, extraLines, unmanaged, lines, block };
}

/**
 * Render the managed block for a configuration.
 * @param values - the configuration values to emit, already merged.
 * @param extraLines - unknown lines to carry over verbatim.
 * @returns the block text, without a trailing newline.
 */
export function renderBlock(values, extraLines) {
  const lines = [MARKERS.start + ' (managed by the dsh-feishu settings page - do not edit by hand)', '- insert:', '    - id: ' + ENTRY.id, '      name: ' + ENTRY.name, '      config:'];
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) continue;
    lines.push('        ' + key + ': ' + renderScalar(values[key]));
  }
  for (const line of extraLines !== undefined ? extraLines : []) {
    if (typeof line === 'string' && line.trim().length > 0) lines.push(line);
  }
  lines.push(MARKERS.end);
  return lines.join('\n');
}

/**
 * Read this plugin's entry straight from a patch file.
 * @param file - the patch file path.
 * @returns the parsed entry, or a failure reason.
 */
export function readEntryFile(file, candidates) {
  if (typeof file !== 'string' || file.length === 0) {
    const tried = Array.isArray(candidates) && candidates.length > 0 ? ' Looked in: ' + candidates.slice(0, 4).join(', ') : '';
    return { ok: false, reason: 'NO_LOCATION', message: 'the profile patch file could not be located.' + tried, candidates: candidates !== undefined ? candidates : [] };
  }
  if (!isProfilePatchPath(file)) return { ok: false, reason: 'UNEXPECTED_PATH', message: 'refusing to read ' + file + ': it is not a profile cordis.patch.yml' };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { ok: false, reason: 'READ_FAILED', message: 'reading ' + file + ' failed: ' + String(error && error.message !== undefined ? error.message : error) };
  }
  const parsed = readEntry(text);
  return { ok: true, file, found: parsed.found, values: parsed.values, unmanaged: parsed.unmanaged };
}

/**
 * Rewrite the plugin's entry with new values, preserving every other line.
 *
 * @param text - the current patch file contents.
 * @param values - the complete set of configuration values to write.
 * @param options - optional behavior.
 * @param options.extraLines - unknown lines to carry over.
 * @returns the new file contents.
 */
export function renderPatch(text, values, options) {
  const lines = String(text).split(/\r?\n/u);
  const block = locateBlock(lines);
  const blockText = renderBlock(values, options !== undefined ? options.extraLines : undefined).split('\n');
  if (block === undefined) {
    const trimmed = lines.length > 0 && lines[lines.length - 1].trim().length === 0 ? lines.slice(0, -1) : lines;
    return [...trimmed, '', ...blockText, ''].join('\n');
  }
  const next = [...lines.slice(0, block.start), ...blockText, ...lines.slice(block.end + 1)];
  return next.join('\n');
}

/**
 * Apply a configuration change to the profile patch file.
 *
 * @param file - the patch file path.
 * @param changes - the values to merge over the current ones.
 * @param options - optional behavior.
 * @param options.dryRun - compute the result without writing.
 * @returns the outcome: whether the location was acceptable, whether the file changed, and the merged values.
 */
export function writeEntry(file, changes, options) {
  const dryRun = options !== undefined && options.dryRun === true;
  if (!isProfilePatchPath(file)) {
    return { ok: false, reason: 'UNEXPECTED_PATH', message: 'refusing to write to ' + String(file) + ': it is not a profile cordis.patch.yml' };
  }
  if (!existsSync(file)) {
    return { ok: false, reason: 'MISSING_FILE', message: 'the profile patch file does not exist: ' + file };
  }
  const original = readFileSync(file, 'utf8');
  const known = options !== undefined && Array.isArray(options.knownKeys) ? options.knownKeys : KNOWN_KEYS;
  const managed = new Set(known);
  const current = readEntry(original, known);
  const merged = { ...current.values };
  for (const key of Object.keys(changes)) {
    if (changes[key] === undefined) continue;
    if (!managed.has(key)) {
      return { ok: false, reason: 'UNKNOWN_KEY', message: 'refusing to write the unmanaged configuration key ' + JSON.stringify(key) };
    }
    if (changes[key] === null) delete merged[key];
    else merged[key] = changes[key];
  }
  const updated = renderPatch(original, merged, { extraLines: current.extraLines });
  if (updated === original) return { ok: true, changed: false, values: merged, unmanaged: current.unmanaged, file };
  if (dryRun) return { ok: true, changed: true, values: merged, unmanaged: current.unmanaged, file, preview: updated };
  const temporary = file + '.dsh-feishu.tmp';
  try {
    writeFileSync(temporary, updated, 'utf8');
    if (!existsSync(file + '.dsh-feishu.bak')) copyFileSync(file, file + '.dsh-feishu.bak');
    renameSync(temporary, file);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      /* the temporary file is best-effort cleanup */
    }
    return { ok: false, reason: 'WRITE_FAILED', message: 'writing ' + file + ' failed: ' + String(error && error.message !== undefined ? error.message : error) };
  }
  return { ok: true, changed: true, values: merged, unmanaged: current.unmanaged, file };
}
