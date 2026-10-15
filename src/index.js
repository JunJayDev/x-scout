// Library entry: the same functions the CLI and the MCP tools use.
export { VERSION, makeContext } from "./util.js";
export { runRead, parseTarget } from "./read.js";
export { runSearch, searchProvider } from "./search.js";
export { runAudit, auditAccount, postSignals } from "./signals.js";
export { callTool, handleMessage, listTools } from "./mcp.js";
export { handleHttp } from "./http.js";
