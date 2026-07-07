#!/usr/bin/env node
// Dedicated entry point so Claude Code can launch the server directly:
//   { "command": "npx", "args": ["-y", "sens-mcp"] }
import { startMcpServer } from "./mcp/server.js";

startMcpServer(process.cwd()).catch((err) => {
  // stdout is reserved for the MCP protocol; log errors to stderr only.
  console.error("[sens] MCP server failed to start:", err);
  process.exit(1);
});
