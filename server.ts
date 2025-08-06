import { TextLineStream } from "@std/streams";
const command = new Deno.Command("vmstat", {
  args: ["1", "-n"],
  stdout: "piped",
});

const process = command.spawn();
console.log("iostat spawned");

const cols = "r,b,swpd,free,buff,cache,si,so,bi,bo,in,cs,us,sy,id,wa,st,gu"
  .split(",");

class VmstatParserStream
  extends TransformStream<string, { [k: string]: number }> {
  constructor() {
    super({
      transform(line, controller) {
        const dataarray = line
          .trim()
          .split(/ +/)
          .map((a) => parseInt(a));
        if (!dataarray.some((a) => isNaN(a))) {
          const data = Object.fromEntries(
            cols.map((a, i) => [a, dataarray[i]]),
          );
          controller.enqueue(data);
        }
      },
    });
  }
}

const sockets: WebSocket[] = [];

import { Hono } from "@hono/hono";

const app = new Hono();

app.get("/", async (c) => {
  const html = await Deno.readTextFile("front.html");
  return c.html(html);
});

const histories = Array.from(
  { length: 51 },
  () => Object.fromEntries(cols.map((a) => [a, -1])),
);
app.get("/ws", (c) => {
  const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

  socket.onopen = () => {
    console.log("🔌 クライアント接続");
    sockets.push(socket);
    socket.send(JSON.stringify(histories));
  };

  socket.onclose = () => {
    console.log("❌ クライアント切断");
    sockets.splice(sockets.indexOf(socket), 1);
  };

  return response;
});

Deno.serve(app.fetch);

process.stdout
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new TextLineStream())
  .pipeThrough(new VmstatParserStream())
  .pipeTo(
    new WritableStream<{ [k: string]: number }>({
      async write(data) {
        histories.shift();
        histories.push(data);
        await Promise.allSettled(
          sockets.map((a) => a.send(JSON.stringify(data))),
        );
      },
    }),
  );
