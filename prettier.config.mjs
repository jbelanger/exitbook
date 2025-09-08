/** @type {import('prettier').Config} */
const config = {
  // Core style
  semi: true,
  singleQuote: true,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
  bracketSameLine: false,
  singleAttributePerLine: true,

  // Plugins (kept here, versions installed at repo root)
  plugins: ["prettier-plugin-tailwindcss", "prettier-plugin-packagejson"],

  // Tailwind helper function names found in your stack
  tailwindFunctions: ["cn", "cva", "clsx", "classnames", "twMerge"],

  // Per-file tweaks
  overrides: [
    {
      files: ["**/*.md", "**/*.mdx"],
      options: { printWidth: 80, proseWrap: "always" },
    },
    { files: ["**/*.json", "**/*.jsonc"], options: { printWidth: 100 } },
    { files: ["**/*.yml", "**/*.yaml"], options: { printWidth: 90 } },
    {
      files: ["**/*.html"],
      options: { printWidth: 100, singleAttributePerLine: true },
    },
  ],
};

export default config;
