/**
 * Maximum size in bytes for any user-uploaded payload.
 *
 * Both the CSV import endpoint (`POST /tickets/import`) and the attachment
 * upload endpoint (`POST /tickets/:ticketId/attachments`) cap the request
 * body here. The PDF (§4.1) mandates a 10 MB ceiling; centralising the
 * constant keeps multer's `limits.fileSize`, the multer-error filter's
 * user-facing message, and any future documentation in lock-step.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
