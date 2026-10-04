// Roles that can look across every branch of their own tenant (the Hub plus
// ON-SITE vans) and so get the "All Branches" selector. Everyone else is
// locked to their own branch. Row-level security in the database enforces the
// same split (see migration 151); this only drives what the UI asks for.
export const ALL_BRANCH_ROLES = ['super_admin', 'ops_manager', 'finance'] as const

export function canSeeAllBranches(role?: string | null): boolean {
  return !!role && (ALL_BRANCH_ROLES as readonly string[]).includes(role)
}

// The branch a page should filter by: the header's selection for roles that
// can see everything (null = all branches), otherwise the user's own branch.
export function scopedBranchId(
  user: { role?: string | null; branch_id?: string | null } | null | undefined,
  selectedBranchId?: string | null,
): string | null {
  if (canSeeAllBranches(user?.role)) return selectedBranchId ?? null
  return user?.branch_id ?? null
}
