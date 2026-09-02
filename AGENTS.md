# Repository Working Agreement

These instructions apply to every task in this repository, including work in `mobile/`.
More specific nested `AGENTS.md` instructions also apply within their directories.

## Branch and pull request workflow

- Treat `main` as the integration branch. Do not commit feature work directly to `main`.
- Use one feature branch per change, normally named with the `codex/` prefix.
- Before starting a new feature branch, fetch `origin` and base the branch on the latest `origin/main`, unless the user explicitly requests a stacked branch based on another feature branch.
- Keep unrelated changes out of the feature branch and pull request.
- Do not merge a pull request or push directly to `main` unless the user explicitly asks for that action.

## Required current-main validation

Before opening a pull request, and again immediately before reporting a pull request as ready to merge:

1. Preserve and report any pre-existing uncommitted changes. Never discard or overwrite them.
2. Run `git fetch origin`.
3. Check whether the feature branch is behind `origin/main`, using `git rev-list --count HEAD..origin/main` or an equivalent command.
4. If the branch is behind, integrate the latest `origin/main` by rebasing or merging according to the established workflow. Prefer rebasing for an agent-owned feature branch; do not rewrite a shared branch without confirming it is safe.
5. Resolve conflicts deliberately. Do not choose conflict resolutions mechanically or discard either side without understanding the product behavior.
6. Run the relevant tests, type checks, and smoke checks after integrating `origin/main`.
7. Confirm the branch diff contains only the intended change.
8. Push the updated feature branch and wait for required GitHub checks before describing it as merge-ready.

If fetching, integration, tests, or required checks fail, do not claim the pull request is current or merge-ready. Report the specific blocker.

## Parallel work

- Parallelize implementation, but serialize integration through `main`.
- Use separate branches and worktrees for simultaneous features.
- Before editing shared product contracts, Supabase schema, migrations, authentication, or central navigation files, check for likely overlap with other active work and call it out.
- Every Supabase schema change must use a new migration. Never modify an already-deployed migration.
- After another pull request merges, every remaining pull request must repeat the current-main validation before it merges.

## Merge standard

A change is ready to merge only when:

- it is based on or has integrated the latest `origin/main`;
- relevant automated tests and checks pass;
- migrations and shared contracts have been reviewed when applicable;
- the pull request has a clear, focused scope; and
- required human review is complete.

Prefer squash merging for focused feature pull requests unless the user requests a different history strategy.
