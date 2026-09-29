import next from "eslint-config-next";
export default [
  ...next,
  { ignores: [".next/**", "src/generated/**", "extension/dist/**", "node_modules/**", "test-results/**", "playwright-report/**"] },
  { rules: { "@next/next/no-img-element": "off", "react-hooks/exhaustive-deps": "warn", "@typescript-eslint/no-explicit-any": "off" } },
];
