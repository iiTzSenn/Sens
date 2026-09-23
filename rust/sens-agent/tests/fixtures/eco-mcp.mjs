import readline from "node:readline";

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "eco", version: "1.0.0" } } });
  } else if (message.method === "tools/list") {
    send({ id: message.id, result: { tools: [{ name: "eco", description: "Devuelve el texto al revés", inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } }] } });
  } else if (message.method === "tools/call") {
    send({ id: message.id, result: { content: [{ type: "text", text: [...message.params.arguments.texto].reverse().join("") }] } });
  } else if (message.id !== undefined) {
    send({ id: message.id, result: {} });
  }
});
