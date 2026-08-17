import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import jsdocPlugin from "eslint-plugin-jsdoc";

export default tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      prettierConfig,
    ],
    plugins: {
      jsdoc: jsdocPlugin,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // Strict TypeScript rules
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",

      // General strictness
      "no-console": ["warn", { allow: ["warn", "error"] }],
      curly: "error",
      eqeqeq: "error",
      "no-var": "error",
      semi: ["error", "always"],

      // Disable useless-escape for template strings that contain JSON
      "no-useless-escape": "off",

      // Enforce JSDoc on public exports
      "jsdoc/require-jsdoc": [
        "warn",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
          },
          contexts: [
            "ExportNamedDeclaration > TSInterfaceDeclaration",
            "ExportNamedDeclaration > TSTypeAliasDeclaration",
          ],
        },
      ],
    },
  },
);
