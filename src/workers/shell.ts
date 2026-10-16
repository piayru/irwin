import { ShellService } from "../core/shell";
import { redact } from "../core/policy";
const shell = new ShellService();
const port = (process as any).parentPort;
const send = (v: any) => (port ? port.postMessage(v) : process.send?.(v));
const sendContext = () => {
  const database = shell.database;
  if (database) send({ event: { type: "shell", data: { database } } });
};
const receive = async ({ id, command, payload }: any) => {
  try {
    const result =
      command === "open"
        ? await shell.open(payload.resolved, payload.database)
        : command === "execute"
          ? await shell.execute(payload.code)
          : command === "next"
            ? await shell.next()
            : await shell.close();
    sendContext();
    send({ id, result });
  } catch (e) {
    sendContext();
    send({ id, error: redact((e as Error).message) });
  }
};
if (port) port.on("message", (e: any) => void receive(e.data));
else process.on("message", (e: any) => void receive(e));
