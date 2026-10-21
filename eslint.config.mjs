import base from "@devbie/style-guide/eslint/base";

export default [
  ...base,
  {
    ignores: ["**/node_modules/**", "**/.trae/**"],
  },
];
