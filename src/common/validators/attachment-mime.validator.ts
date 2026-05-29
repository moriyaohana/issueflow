import { ALLOWED_ATTACHMENT_MIME_TYPES } from '../enums/attachment-mime-type.enum';

/**
 * Regex used by Nest's `FileTypeValidator` to gate uploads on MIME type.
 *
 * `ALLOWED_ATTACHMENT_MIME_TYPES` is a typed enum array (e.g. `image/png`,
 * `text/plain`); the only metachar in scope is `/`, so a plain alternation
 * is safe — no escaping needed. Living next to the enum keeps the allowlist
 * and its derived regex in one place, instead of being rebuilt at module
 * load inside `AttachmentsController`.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPE_REGEX = new RegExp(
  `^(?:${ALLOWED_ATTACHMENT_MIME_TYPES.join('|')})$`,
);
