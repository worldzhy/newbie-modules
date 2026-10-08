/**
 * Thin entry loaded by the framework CLI's dynamic module-CLI loader
 * (`cli` field in newbie.module.json). The implementation lives in the
 * framework-owned `@devbie/aws-secrets-cli` package (declared in this module's
 * `dependencies`, so the consuming project installs it from npm); this file
 * only re-exports the package's `register(parent, options)` hook.
 */
export { register } from "@devbie/aws-secrets-cli";
