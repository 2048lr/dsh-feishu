/**
 * Feishu Messenger (消息) actions.
 *
 * Covers both delivery paths: the app/bot API, which needs a chat or user id
 * and the bot present in the conversation, and the custom-bot webhook, which
 * needs nothing but a URL and is the right choice for a one-off notification.
 *
 * @module dsh-feishu/tools/im
 */

import { defineTool, ok, IDENTITY_PARAMETER, jsonParam, stringParam } from './kit.js';
import { readLocalFile, contentTypeFor } from '../local-file.js';
import { httpRequest } from '../http.js';
import { FeishuError } from '../errors.js';

/** How a receive id is interpreted. */
const RECEIVE_ID_TYPES = ['open_id', 'user_id', 'union_id', 'email', 'chat_id'];

/**
 * Build the Messenger tool.
 * @param deps - composition facts.
 * @param deps.client - the Feishu client.
 * @returns the tool definition.
 */
export function createMessageTool(deps) {
  const client = deps.client;

  /**
   * Send one message through the bot API.
   * @param parameters - the send facts.
   * @returns the API payload.
   */
  async function send(parameters) {
    if (typeof parameters.receiveId !== 'string' || parameters.receiveId.length === 0) {
      throw new Error(parameters.receiveIdType + ' delivery needs a receiveId');
    }
    return client.call({
      method: 'POST',
      path: '/im/v1/messages',
      query: { receive_id_type: parameters.receiveIdType },
      body: { receive_id: parameters.receiveId, msg_type: parameters.msgType, content: parameters.content },
      identity: parameters.identity,
      signal: parameters.signal,
    });
  }

  return defineTool({
    name: 'feishu_message',
    timeoutMs: 180000,
    description: [
      'Send Feishu messages.',
      'Actions: send_text, send_card (an interactive card), send_post (a rich-text post), send_file (upload a local file and send it), send_image (upload a local image and send it), reply (reply in an existing message thread), webhook (post through a custom-bot webhook URL, which needs no app credentials).',
      'receiveIdType says how to read receiveId: open_id (the usual person id), user_id, union_id, email, or chat_id (a group). The bot must be a member of the target chat.',
      'For send_card and send_post, content is the card or post JSON object; for send_text, text is the plain message body.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['send_text', 'send_card', 'send_post', 'send_file', 'send_image', 'reply', 'webhook'],
        description: 'The Messenger operation to perform.',
      },
      receiveIdType: { type: 'string', enum: RECEIVE_ID_TYPES, description: 'How receiveId is interpreted (default open_id).' },
      receiveId: stringParam('The recipient: an open_id, user_id, union_id, email, or chat_id matching receiveIdType.'),
      text: stringParam('The plain text body for send_text.'),
      content: jsonParam('The card or post JSON object for send_card and send_post.'),
      title: stringParam('A title for send_post or send_card headers when content does not carry one.'),
      filePath: stringParam('Local path of the file or image to upload for send_file or send_image.'),
      messageId: stringParam('The message id to reply to (reply).'),
      webhookUrl: stringParam('The full custom-bot webhook URL for the webhook action.'),
      webhookText: stringParam('The message body for the webhook action.'),
      identity: IDENTITY_PARAMETER,
    },
    async execute(args, exec) {
      const signal = exec !== undefined && exec.signal !== undefined ? exec.signal : undefined;
      const identity = args.identity;
      const action = args.action;
      const receiveIdType = typeof args.receiveIdType === 'string' && args.receiveIdType.length > 0 ? args.receiveIdType : 'open_id';

      if (action === 'send_text') {
        if (typeof args.text !== 'string' || args.text.length === 0) throw new Error('send_text needs text');
        const data = await send({ receiveId: args.receiveId, receiveIdType, msgType: 'text', content: JSON.stringify({ text: args.text }), identity, signal });
        return ok({
          action,
          summary: 'sent a text message to ' + receiveIdType + ' ' + args.receiveId,
          identity,
          data: { message_id: data !== null && typeof data === 'object' ? data.message_id : undefined },
        });
      }

      if (action === 'send_card') {
        const card = args.content !== undefined ? args.content : args.text !== undefined ? { elements: [{ tag: 'markdown', content: String(args.text) }] } : undefined;
        if (card === undefined) throw new Error('send_card needs content (the card JSON) or text');
        const payload = args.title !== undefined ? { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: String(args.title) } }, elements: Array.isArray(card.elements) ? card.elements : [card] } : card;
        const data = await send({ receiveId: args.receiveId, receiveIdType, msgType: 'interactive', content: JSON.stringify(payload), identity, signal });
        return ok({
          action,
          summary: 'sent an interactive card to ' + receiveIdType + ' ' + args.receiveId,
          identity,
          data: { message_id: data !== null && typeof data === 'object' ? data.message_id : undefined },
        });
      }

      if (action === 'send_post') {
        const post = args.content !== undefined ? args.content : undefined;
        if (post === undefined) throw new Error('send_post needs content (the post JSON object)');
        const data = await send({ receiveId: args.receiveId, receiveIdType, msgType: 'post', content: JSON.stringify(post), identity, signal });
        return ok({
          action,
          summary: 'sent a post to ' + receiveIdType + ' ' + args.receiveId,
          identity,
          data: { message_id: data !== null && typeof data === 'object' ? data.message_id : undefined },
        });
      }

      if (action === 'send_file') {
        const file = await readLocalFile(args.filePath, exec);
        const uploaded = await client.upload({
          path: '/im/v1/files',
          fields: { file_type: 'stream', file_name: file.name },
          file: { name: file.name, bytes: file.bytes, contentType: contentTypeFor(file.name) },
          identity,
          signal,
        });
        const fileKey = uploaded !== null && typeof uploaded === 'object' ? uploaded.file_key : undefined;
        if (typeof fileKey !== 'string' || fileKey.length === 0) throw new Error('the file upload returned no file_key');
        const data = await send({ receiveId: args.receiveId, receiveIdType, msgType: 'file', content: JSON.stringify({ file_key: fileKey }), identity, signal });
        return ok({
          action,
          summary: 'sent ' + file.name + ' (' + file.size + ' bytes)',
          identity,
          data: { message_id: data !== null && typeof data === 'object' ? data.message_id : undefined, fileKey },
        });
      }

      if (action === 'send_image') {
        const file = await readLocalFile(args.filePath, exec, 10 * 1024 * 1024);
        const uploaded = await client.upload({
          path: '/im/v1/images',
          fields: { image_type: 'message' },
          file: { field: 'image', name: file.name, bytes: file.bytes, contentType: contentTypeFor(file.name) },
          identity,
          signal,
        });
        const imageKey = uploaded !== null && typeof uploaded === 'object' ? uploaded.image_key : undefined;
        if (typeof imageKey !== 'string' || imageKey.length === 0) throw new Error('the image upload returned no image_key');
        const data = await send({ receiveId: args.receiveId, receiveIdType, msgType: 'image', content: JSON.stringify({ image_key: imageKey }), identity, signal });
        return ok({
          action,
          summary: 'sent image ' + file.name,
          identity,
          data: { message_id: data !== null && typeof data === 'object' ? data.message_id : undefined, imageKey },
        });
      }

      if (action === 'reply') {
        if (typeof args.messageId !== 'string' || args.messageId.length === 0) throw new Error('reply needs a messageId');
        const text = typeof args.text === 'string' ? args.text : undefined;
        const content = args.content !== undefined ? JSON.stringify(args.content) : text !== undefined ? JSON.stringify({ text }) : undefined;
        if (content === undefined) throw new Error('reply needs text or content');
        const data = await client.call({
          method: 'POST',
          path: '/im/v1/messages/' + args.messageId + '/reply',
          body: { msg_type: args.content !== undefined ? 'interactive' : 'text', content },
          identity,
          signal,
        });
        return ok({ action, summary: 'replied to message ' + args.messageId, identity, data });
      }

      if (action === 'webhook') {
        if (typeof args.webhookUrl !== 'string' || args.webhookUrl.length === 0) throw new Error('webhook needs a webhookUrl');
        const text = typeof args.webhookText === 'string' && args.webhookText.length > 0 ? args.webhookText : args.text;
        if (typeof text !== 'string' || text.length === 0) throw new Error('webhook needs webhookText (or text)');
        const response = await httpRequest({
          url: args.webhookUrl,
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ msg_type: 'text', content: { text } }),
          timeoutMs: client.config.requestTimeoutMs,
          maxRetries: client.config.maxRetries,
          signal,
        });
        let parsed;
        try {
          parsed = response.text.length > 0 ? JSON.parse(response.text) : {};
        } catch {
          throw new FeishuError('the webhook returned a non-JSON response', { httpStatus: response.status, detail: response.text.slice(0, 200) });
        }
        const code = parsed !== null && typeof parsed === 'object' ? parsed.code : undefined;
        if (response.status >= 400 || (typeof code === 'number' && code !== 0)) {
          throw new FeishuError(parsed !== null && typeof parsed.msg === 'string' ? parsed.msg : 'the webhook rejected the message', {
            code: typeof code === 'number' ? code : undefined,
            httpStatus: response.status,
            path: 'custom-bot webhook',
            detail: response.text.slice(0, 200),
          });
        }
        return ok({ action, summary: 'posted ' + text.length + ' characters through the webhook', identity: 'webhook', data: parsed });
      }

      throw new Error('unsupported Messenger action: ' + String(action));
    },
  });
}
