import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

// Next.js generates this file; do not lint or hand-edit it.
const config = [
  { ignores: ["next-env.d.ts", ".next/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
