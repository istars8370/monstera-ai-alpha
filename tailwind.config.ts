import type { Config } from "tailwindcss";
export default { content: ["./app/**/*.{ts,tsx}","./components/**/*.{ts,tsx}"], theme: { extend: { colors: { background: "hsl(var(--background))", foreground: "hsl(var(--foreground))" } } }, plugins: [] } satisfies Config;
