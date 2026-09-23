import readline from "node:readline";

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : "";
};
const session = flag("--session-id") || flag("--resume");
const say = (message) => process.stdout.write(JSON.stringify({ session_id: session, ...message }) + "\n");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let answerFor = null;
let interrupted = false;

const finish = (subtype = "success", result = "") =>
  say({
    type: "result",
    subtype,
    is_error: subtype !== "success",
    duration_ms: 12,
    num_turns: 1,
    result,
    usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 5, output_tokens: 2 },
  });

const speak = (text) => {
  for (const piece of [text.slice(0, 2), text.slice(2)]) {
    say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }, parent_tool_use_id: null });
  }
  say({ type: "assistant", message: { content: [{ type: "text", text }] }, parent_tool_use_id: null });
};

async function turn(content) {
  say({ type: "system", subtype: "init", model: argv.join(" ") });
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const pictures = blocks.filter((block) => block.type === "image" && block.source?.type === "base64");
  if (pictures.length) {
    speak(`vi ${pictures.length} imagen ${pictures[0].source.media_type} antes de "${text}"`);
    return finish();
  }
  if (text.includes("muere")) {
    process.stderr.write("se acabó la cuerda");
    process.exit(1);
  }
  if (text.includes("permiso")) {
    say({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_w", name: "Write", input: { file_path: "n.txt", content: "hecho" } }] }, parent_tool_use_id: null });
    say({
      type: "control_request",
      request_id: "p1",
      request: { subtype: "can_use_tool", tool_name: "Write", input: { file_path: "n.txt", content: "hecho" }, permission_suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] },
    });
    const response = await new Promise((resolve) => (answerFor = resolve));
    const allowed = response.behavior === "allow";
    say({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_w", content: allowed ? "creado" : response.message, is_error: !allowed }] }, parent_tool_use_id: null, tool_use_result: { type: "create", filePath: "n.txt" } });
    speak(allowed ? "permitido" : "rechazado");
    return finish();
  }
  if (text.includes("lento")) {
    interrupted = false;
    for (let count = 0; count < 100 && !interrupted; count++) {
      say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${count} ` } }, parent_tool_use_id: null });
      await sleep(40);
    }
    return interrupted ? finish("error_during_execution") : finish();
  }
  speak("Hola");
  return finish();
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "control_request" && message.request.subtype === "initialize") {
    say({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
  } else if (message.type === "control_request" && message.request.subtype === "interrupt") {
    interrupted = true;
    say({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
  } else if (message.type === "control_response" && answerFor) {
    const resolve = answerFor;
    answerFor = null;
    resolve(message.response.response);
  } else if (message.type === "user") {
    turn(message.message.content);
  }
});
