/**
 * Audit action vocabulary documented in the README. The `entityType` column on
 * each audit row disambiguates which subject the verb applies to — there is no
 * `TICKET_CREATE` vs `USER_CREATE`, just `CREATE` with `entityType: TICKET` or
 * `entityType: USER`. `LOGIN` is kept distinct because it is not a state change
 * on a particular entity in the README sense.
 */
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  RESTORE = 'RESTORE',
  AUTO_ESCALATE = 'AUTO_ESCALATE',
  AUTO_ASSIGN = 'AUTO_ASSIGN',
  LOGIN = 'LOGIN',
}
