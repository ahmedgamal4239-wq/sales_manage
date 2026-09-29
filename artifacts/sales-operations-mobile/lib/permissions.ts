import type { Employee, Permission } from '@workspace/api-client-react';

export function hasPermission(user: Employee | null | undefined, permission: Permission): boolean {
  return user?.effectivePermissions.includes(permission) ?? false;
}