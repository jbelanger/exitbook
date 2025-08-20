/** @type {import("eslint").Linter.Config} */
module.exports = {
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint"],
    env: {
        node: true,
        es2021: true
    },
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module"
    }
};