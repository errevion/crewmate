module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "prettier"
  ],
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  rules: {
    // Strict TypeScript rules
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_" }
    ],
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { prefer: "front-imports" }
    ],
    "@typescript-eslint/no-non-null-assertion": "warn",

    // General strictness
    "no-console": ["warn", { allow: ["warn", "error"] }],
    curly: "error",
    eqeqeq: "error",
    "no-var": "error",
    semi: ["error", "always"]
  },
  ignorePatterns: ["dist/", "node_modules/", ".opencode/", "*.json"]
};
