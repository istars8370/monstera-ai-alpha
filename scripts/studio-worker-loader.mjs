// Node 22 ESM alias resolver for the explicitly launched Studio mock-only CLI.
// Production application imports are unchanged; no database or provider mocking.
export async function resolve(specifier,context,nextResolve) {
  if(specifier.startsWith("@/")) {
    const path=specifier.slice(2);
    if(!/^[A-Za-z0-9/_-]+$/.test(path))throw new Error("INVALID_STUDIO_IMPORT");
    return nextResolve(new URL("../"+path+".ts",import.meta.url).href,context);
  }
  if((specifier.startsWith("./")||specifier.startsWith("../")) &&
      context.parentURL?.endsWith(".ts") &&
      !/\.(ts|tsx|mjs|js|json)$/.test(specifier)) {
    return nextResolve(new URL(specifier+".ts",context.parentURL).href,context);
  }
  return nextResolve(specifier,context);
}
