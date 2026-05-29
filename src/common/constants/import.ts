/**
 * Maximum number of CSV rows accepted in a single `POST /tickets/import`
 * request. The 10 MB body limit (see {@link MAX_UPLOAD_BYTES}) protects
 * against extreme payload sizes; this row cap protects against
 * pathologically-narrow CSVs (e.g. 10 MB of single-character titles) that
 * would still spawn tens of thousands of per-row transactions and time the
 * request out.
 */
export const MAX_IMPORT_ROWS = 5000;
