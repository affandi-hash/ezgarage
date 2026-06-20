// Ensures non-CEO users can only access their own branch's data
export function enforceBranch(req, res, next) {
  if (req.user.role === 'ceo') {
    return next() // CEO sees all branches
  }

  const requestedBranchId = req.params.branchId || req.body.branch_id || req.query.branch_id
  if (requestedBranchId && requestedBranchId !== req.user.branch_id) {
    return res.status(403).json({ error: 'Access denied to this branch' })
  }

  // Inject branch_id into body so controllers always have it
  req.body.branch_id = req.user.branch_id
  next()
}
