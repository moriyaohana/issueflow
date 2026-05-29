import { ALLOWED_ATTACHMENT_MIME_TYPES } from '../enums/attachment-mime-type.enum';

export const ALLOWED_ATTACHMENT_MIME_TYPE_REGEX = new RegExp(
  `^(?:${ALLOWED_ATTACHMENT_MIME_TYPES.join('|')})$`,
);
