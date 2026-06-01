// ESLint flat config — SPA lint gate.
//
// Scope: src/ (the React 19 SPA). Rules per the owner review:
//   • react-hooks/rules-of-hooks   → error  (catches real bugs)
//   • react-hooks/exhaustive-deps  → warn   (advisory; the chat runtime
//                                            already carries deliberate
//                                            eslint-disable lines)
//   • @typescript-eslint/no-unused-vars  → warn (ignores _-prefixed)
//   • @typescript-eslint/no-explicit-any → warn
//
// Deliberately NOT type-checked (no `recommendedTypeChecked`): we already
// gate types with `tsc` in `pnpm typecheck`; this lint is fast and
// syntactic. tests/ + config files are excluded for the first pass.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "venv/**",
      "coverage/**",
      "tests/**",
      "scripts/**",
      "*.config.ts",
      "*.config.js",
      "*.config.mts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // TS compiler resolves identifiers; no-undef false-positives on types.
      "no-undef": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
