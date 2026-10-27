export type UserRole = 'owner' | 'admin_staff' | 'audit_teller' | 'conductor' | 'driver';

/** Roles with full owner-portal access (mirrors server OWNER_LEVEL_ROLES). */
export const OWNER_LEVEL_ROLES: UserRole[] = ['owner', 'admin_staff'];

export const USER_ROLES: { value: Exclude<UserRole, 'owner'>; label: string }[] = [
  { value: 'admin_staff', label: 'Admin Staff' },
  { value: 'audit_teller', label: 'Audit Teller' },
  { value: 'conductor', label: 'Conductor' },
  { value: 'driver', label: 'Driver' },
];

export const NAME_SUFFIXES: string[] = ['Jr.', 'Sr.', 'I', 'II', 'III', 'IV', 'V'];
