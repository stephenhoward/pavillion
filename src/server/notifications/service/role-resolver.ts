import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';

/**
 * Closed enum of audience roles supported by the notifications domain.
 *
 * This is intentionally a small, closed set —
 * adding a new role is a notifications-domain change. At three roles the
 * implementation is a direct switch, not a registry abstraction.
 */
export type NotificationRole =
  | 'calendar-editors'
  | 'calendar-owners'
  | 'instance-admins';

/**
 * Reference to the domain object the audience is scoped to. The `type`
 * the resolver accepts is role-specific; mismatches throw rather than
 * silently returning an empty list.
 */
export interface RoleObjectRef {
  type: string;
  id: string;
}

/**
 * Cross-domain dependencies the resolver consumes. Both interfaces are
 * injected so the notifications domain never imports calendar/accounts
 * internals (see backend-domain-structure / cross-domain-injection).
 */
export interface RoleResolverDeps {
  calendarInterface: CalendarInterface;
  accountsInterface: AccountsInterface;
}

/**
 * Maps `(role, objectRef?)` to the list of account IDs that should
 * receive a notification activity. Used by `recordActivity` when the
 * activity's `audience.kind === 'role'`.
 *
 * Each role declares the object type it accepts:
 *   - `calendar-editors` and `calendar-owners` require an objectRef of
 *     type `'calendar'`. Both missing and mismatched object types throw.
 *   - `instance-admins` is a global role and accepts no objectRef.
 *     Passing one throws.
 *
 * @param role - The audience role to resolve
 * @param objectRef - Reference to the object the role applies to, or
 *   undefined for global roles
 * @param deps - Cross-domain interfaces (calendar, accounts)
 * @returns Array of account IDs; empty array if no role-holders exist
 */
export async function resolveRoleAudience(
  role: NotificationRole,
  objectRef: RoleObjectRef | undefined,
  deps: RoleResolverDeps,
): Promise<string[]> {
  switch (role) {
    case 'calendar-editors': {
      const ref = requireObjectOfType(role, objectRef, 'calendar');
      const editors = await deps.calendarInterface.getEditorsForCalendar(ref.id);
      return editors.map(account => account.id);
    }
    case 'calendar-owners': {
      const ref = requireObjectOfType(role, objectRef, 'calendar');
      const owners = await deps.calendarInterface.getOwnersForCalendar(ref.id);
      return owners.map(account => account.id);
    }
    case 'instance-admins': {
      if (objectRef !== undefined) {
        throw new Error(
          `Role '${role}' requires no object; received objectRef of type '${objectRef.type}'`,
        );
      }
      return deps.accountsInterface.getInstanceAdmins();
    }
    default: {
      // Exhaustiveness check — TypeScript will flag a missing role at
      // compile time; this branch catches runtime drift if the type is
      // widened by a caller.
      const exhaustiveCheck: never = role;
      throw new Error(`Unknown notification role: ${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * Asserts that `objectRef` is present and of the expected type. Returns
 * the narrowed ref on success; throws on missing or mismatched type.
 */
function requireObjectOfType(
  role: NotificationRole,
  objectRef: RoleObjectRef | undefined,
  expectedType: string,
): RoleObjectRef {
  if (objectRef === undefined) {
    throw new Error(
      `Role '${role}' requires an object of type '${expectedType}'; received none`,
    );
  }
  if (objectRef.type !== expectedType) {
    throw new Error(
      `Role '${role}' requires an object of type '${expectedType}'; received '${objectRef.type}'`,
    );
  }
  return objectRef;
}
