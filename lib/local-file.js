/**
 * Local file access for the actions that upload or import something.
 *
 * Paths are resolved the way every other tool resolves them: an absolute path
 * is used as given, and a relative path is resolved against the calling
 * session's working directory rather than against the host process, so a
 * relative path in a tool call means what the user sees in the workspace.
 *
 * @module dsh-feishu/local-file
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, basename } from 'node:path';

/** Refuse to buffer more than this for one upload. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Content types worth sending explicitly; Feishu mostly keys off the extension. */
const CONTENT_TYPES = {
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
};

/**
 * Resolve a caller-supplied path against the session working directory.
 * @param input - the path from the tool call.
 * @param exec - the tool execution context.
 * @returns the absolute path.
 */
export function resolveLocalPath(input, exec) {
  if (typeof input !== 'string' || input.trim().length === 0) throw new Error('a file path is required');
  const raw = input.trim();
  if (isAbsolute(raw)) return raw;
  const cwd = exec !== undefined && exec.agent !== undefined && exec.agent.session !== undefined ? exec.agent.session.header.cwd : undefined;
  return cwd !== undefined ? resolve(cwd, raw) : resolve(raw);
}

/**
 * Guess a content type from a file name.
 * @param name - the file name.
 * @returns the content type, or the generic binary type.
 */
export function contentTypeFor(name) {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const extension = name.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[extension] !== undefined ? CONTENT_TYPES[extension] : 'application/octet-stream';
}

/**
 * Read a local file for upload.
 * @param input - the caller path.
 * @param exec - the tool execution context.
 * @param maxBytes - the size ceiling.
 * @returns the file name, bytes, size, and resolved path.
 */
export async function readLocalFile(input, exec, maxBytes) {
  const path = resolveLocalPath(input, exec);
  const limit = maxBytes !== undefined ? maxBytes : MAX_UPLOAD_BYTES;
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw new Error('cannot read ' + path + ': ' + String(error && error.message));
  }
  if (!info.isFile()) throw new Error(path + ' is not a regular file');
  if (info.size > limit) throw new Error(path + ' is ' + info.size + ' bytes, above the ' + limit + ' byte upload limit');
  const bytes = await readFile(path);
  return { path, name: basename(path), bytes, size: info.size };
}

/**
 * Write downloaded bytes to a local path.
 * @param path - the absolute destination path.
 * @param bytes - the bytes to write.
 * @returns the byte count written.
 */
export async function writeLocalFile(path, bytes) {
  await writeFile(path, bytes);
  return bytes.length;
}

/**
 * Derive the file extension Feishu import tasks expect.
 * @param name - the file name.
 * @returns the lowercase extension without the dot.
 */
export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}
