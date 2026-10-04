import { Client } from "ssh2";
import { createServer, type Server, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { ConnectionString } from "mongodb-connection-string-url";
import type { Profile, Secrets, ResolvedConnection } from "../shared/contracts";
import { effectiveConnectionOptions } from "../shared/connection-options";

export interface Route {
  resolved: ResolvedConnection;
  close(): void;
}
export async function resolveConnection(
  profile: Profile,
  secrets: Secrets,
): Promise<Route> {
  const url = new ConnectionString(profile.uri);
  if (url.password)
    throw new Error("Credentials must be normalized before connecting");
  const uriOptions = new Map(
    [...url.searchParams].map(([k, v]) => [k.toLowerCase(), v]),
  );
  const effective = effectiveConnectionOptions(profile);
  for (const key of [
    "tlsinsecure",
    "tlsallowinvalidcertificates",
    "tlsallowinvalidhostnames",
  ])
    if (uriOptions.get(key) === "true")
      throw new Error(
        "TLS certificate and hostname verification must remain enabled",
      );
  const options: Record<string, any> = {
    appName: "Irwin",
    serverSelectionTimeoutMS: Number(effective.serverSelectionTimeoutMS.value),
    connectTimeoutMS: Number(effective.connectTimeoutMS.value),
    readPreference: effective.readPreference.value,
    writeConcern: { w: effective.w.value === "majority" ? "majority" : Number(effective.w.value) },
    retryWrites: effective.retryWrites.value === "true",
  };
  if (profile.username) {
    options.auth = {
      username: profile.username,
      password: secrets.password || "",
    };
    options.authSource = profile.authSource;
  }
  if (profile.authMechanism !== "DEFAULT")
    options.authMechanism = profile.authMechanism;
  if (effective.tls.value === "true") options.tls = true;
  if (profile.caFile) options.tlsCAFile = profile.caFile;
  if (profile.certFile) options.tlsCertificateKeyFile = profile.certFile;
  if (secrets.certPassword)
    options.tlsCertificateKeyFilePassword = secrets.certPassword;
  if (profile.replicaSet) options.replicaSet = profile.replicaSet;
  if (profile.directConnection) options.directConnection = true;
  for (const key of [
    "authSource",
    "authMechanism",
    "replicaSet",
    "readPreference",
    "directConnection",
    "serverSelectionTimeoutMS",
    "connectTimeoutMS",
  ])
    if (uriOptions.has(key.toLowerCase())) delete options[key];
  if (uriOptions.has("w")) delete options.writeConcern;
  if (
    profile.retryWrites === undefined &&
    profile.provider !== "cosmos" &&
    uriOptions.has("retrywrites")
  )
    delete options.retryWrites;
  if (!profile.ssh.enabled)
    return { resolved: { profile, uri: url.toString(), options }, close() {} };
  if (url.isSRV || url.hosts.length !== 1 || effective.replicaSet.value)
    throw new Error(
      "SSH v1 supports a single standard URI target, without replica-set discovery",
    );
  const target = new URL(`http://${url.hosts[0]}`);
  const remoteHost = target.hostname.replace(/^\[|\]$/g, "");
  const remotePort = Number(target.port || 27017);
  const ssh = new Client();
  let server: Server | undefined;
  const sockets = new Set<Socket>();
  const privateKey = profile.ssh.privateKeyFile
    ? await readFile(profile.ssh.privateKeyFile)
    : undefined;
  let fingerprint = "";
  const close = () => {
    for (const socket of sockets) socket.destroy();
    server?.close();
    ssh.end();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      ssh
        .once("ready", resolve)
        .on("error", (error) =>
          reject(
            new Error(
              fingerprint
                ? `SSH host key must be verified. SHA256 hex: ${fingerprint}`
                : error.message,
            ),
          ),
        );
      ssh.connect({
        host: profile.ssh.host,
        port: profile.ssh.port,
        username: profile.ssh.username,
        password: secrets.sshPassword,
        privateKey,
        passphrase: secrets.sshPassphrase,
        readyTimeout: profile.timeoutMS,
        hostHash: "sha256",
        hostVerifier: (hash: string) => {
          if (
            profile.ssh.hostFingerprint.toLowerCase() !== hash.toLowerCase()
          ) {
            fingerprint = hash;
            return false;
          }
          return true;
        },
      });
    });
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      ssh.forwardOut(
        "127.0.0.1",
        socket.remotePort || 0,
        remoteHost,
        remotePort,
        (error, stream) => {
          if (error) {
            socket.destroy();
            return;
          }
          stream.on("error", () => socket.destroy());
          socket.on("close", () => stream.destroy());
          socket.pipe(stream).pipe(socket);
        },
      );
    });
    await new Promise<void>((resolve, reject) =>
      server!.once("error", reject).listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as any).port;
    url.hosts = [`127.0.0.1:${port}`];
    options.directConnection = true;
    if (effective.tls.value === "true")
      options.servername = remoteHost;
    ssh.on("close", () => {
      for (const socket of sockets) socket.destroy();
    });
    return { resolved: { profile, uri: url.toString(), options }, close };
  } catch (e) {
    close();
    throw e;
  }
}
