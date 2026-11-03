// Output limits are checked server-side; clients cannot override the configured maximum.
export function outputTokenLimit(requested?:number,env:NodeJS.ProcessEnv=process.env):number {
  const raw=env.MONSTERA_MAX_OUTPUT_TOKENS ?? "4096";
  if(!/^[1-9][0-9]{0,4}$/.test(raw))throw new Error("INVALID_OUTPUT_TOKEN_CAP");
  const cap=Number(raw);
  if(cap<1||cap>16384)throw new Error("INVALID_OUTPUT_TOKEN_CAP");
  const value=requested===undefined?Math.min(1024,cap):requested;
  if(!Number.isSafeInteger(value)||value<1||value>cap)throw new Error("INVALID_OUTPUT_TOKEN_LIMIT");
  return value;
}
