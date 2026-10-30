/**
 * 功能：为网页、测试与 Node 脚本提供 ESLint 检查，将排版交由 Prettier。
 * 首次编写日期：2026-10-30
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-30：首次编写，组合 JavaScript、TypeScript、Vue 推荐规则并隔离生成文件。
 */
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "dist/**",
      "coverage/**",
      ".sites-runtime/**",
      "firmware/.tools/**",
      "firmware/.pio/**",
      "firmware/build/**",
      "firmware/artifacts/**",
      "**/__pycache__/**",
      "tests/fixtures/**",
      "firmware/tests/fixtures/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,vue}"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: "latest" },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["**/*.{ts,mts,cts,vue}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.vue"],
    extends: [vue.configs["flat/recommended"]],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ["src/**/*.{js,mjs,ts,mts,vue}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.{js,mjs,cjs,ts}", "tools/**/*.{js,mjs,cjs,ts,mts}", "firmware/tests/**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["tests/**/*.{js,mjs,cjs,ts,mts}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  // Disable only formatting rules that conflict with the shared Prettier configuration.
  prettier,
);
