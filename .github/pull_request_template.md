## Summary


## Design review
- [ ] This change introduces no new cross-host contract, renamed concept, or architecture decision, OR an ADR is linked below and was accepted before this PR was opened.
  - ADR:

## Module coupling
- [ ] New or changed module dependencies are declared explicitly in `newbie.module.json` (`moduleDependencies`) and `newbie dev lint` passes.

## Security review
- [ ] No raw credentials (tokens, passwords, full request/response bodies) are written to logs, audit records, or error messages by this change.

## Audit coverage
- [ ] If this PR adds or changes an auth/session/login code path, every new success and failure branch calls the audit log service, and `account/auth/login-audit-coverage.test.ts` (or the equivalent contract test for the module touched) is updated and passing.

## Tech debt
- [ ] This PR does not leave new `any` types or TODOs in code paths it enables/assembles. Debt in a module is paid in the same PR that turns the module on.

## Coordination
- [ ] Checked `git log`/`git status` and `PENDING_PUSH.md` for other in-flight work on the same module before starting this change.
- [ ] `PENDING_PUSH.md` is updated with this commit if pushing to the remote is deferred to the user.
