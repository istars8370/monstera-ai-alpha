// Test-process-only ESM resolver: use real production source with mocked DB/Redis.
// This loader is enabled exclusively by the Node test command, not by Next.js.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (specifier === "@/db/pool") {
    return nextResolve(new URL("./mocks/db-pool.mjs", import.meta.url).href, context);
  }
  if (specifier === "@upstash/redis") {
    return nextResolve(new URL("./mocks/upstash.mjs", import.meta.url).href, context);
  }
  if (specifier.startsWith("@/")) {
    const path = specifier.slice(2);
    if (!/^[A-Za-z0-9/_-]+$/.test(path)) throw new Error("UNSUPPORTED_TEST_ALIAS");
    return nextResolve(new URL("../" + path + ".ts", import.meta.url).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.endsWith(".ts") &&
      !/\.(ts|tsx|js|mjs|json)$/.test(specifier)) {
    return nextResolve(new URL(specifier + ".ts", context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
}
