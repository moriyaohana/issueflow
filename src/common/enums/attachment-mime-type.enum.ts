export enum AttachmentMimeType {
  IMAGE_PNG = 'image/png',
  IMAGE_JPEG = 'image/jpeg',
  APPLICATION_PDF = 'application/pdf',
  TEXT_PLAIN = 'text/plain',
}

export const ALLOWED_ATTACHMENT_MIME_TYPES: AttachmentMimeType[] = [
  AttachmentMimeType.IMAGE_PNG,
  AttachmentMimeType.IMAGE_JPEG,
  AttachmentMimeType.APPLICATION_PDF,
  AttachmentMimeType.TEXT_PLAIN,
];
