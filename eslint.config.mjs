import base from "@devbie/style-guide/eslint/base";
import nest from "@devbie/style-guide/eslint/nest";

export default [
  ...base,
  ...nest,
  {
    ignores: ["**/node_modules/**", "**/.trae/**"],
  },
  {
    rules: {
      // The registry stores unassembled module sources, so there is no module graph that
      // could reference these providers and controllers. The host lints the assembled
      // graph and keeps this rule enabled there.
      "@darraghor/nestjs-typed/injectable-should-be-provided": "off",
    },
  },
  {
    // This repo holds module sources without their dependency tree, so a property type that
    // comes from outside these sources (the host-generated Prisma client, an SDK package that
    // is not installed here) resolves to `any` and makes a required property look nullable.
    // Assembled hosts resolve the real types and keep the rule enabled.
    files: [
      "packages/modules/account/auth/auth.dto.ts",
      "packages/modules/account/modules/permission/permission.dto.ts",
      "packages/modules/aws-ses/suppression-list/suppression-list.dto.ts",
      "packages/modules/membership/subscription/subscription.dto.ts",
      "packages/modules/membership/subscription/wechat-subscription/wechat-subscription.dto.ts",
      "packages/modules/order/order.dto.ts",
      "packages/modules/shortcut/shortcut-item.dto.ts",
    ],
    rules: {
      "@darraghor/nestjs-typed/all-properties-have-explicit-defined": "off",
    },
  },
  {
    // The host binds these providers through custom tokens (useClass) or APP_GUARD, which
    // this repo cannot see because it only holds unassembled sources. Keeping the rule on
    // for exactly these files keeps their intentional per-class suppressions meaningful,
    // mirroring host configuration instead of deleting the suppressions from the sources.
    files: [
      "packages/modules/account/security-ports/access-token-session.resolver.ts",
      "packages/modules/account/security-ports/api-key.verifier.ts",
      "packages/modules/account/security-ports/login-account.resolver.ts",
      "packages/modules/account/security-ports/permission.authorizer.ts",
      "packages/modules/security/authentication/authentication.guard.ts",
      "packages/modules/security/rate-limiter/rate-limiter.guard.ts",
    ],
    rules: {
      "@darraghor/nestjs-typed/injectable-should-be-provided": "error",
    },
  },
];
