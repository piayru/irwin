import type { Profile } from "./contracts";

export type ConnectionOption = {
  value: string;
  source: "uri" | "settings" | "provider" | "driver" | "tunnel";
};

export function effectiveConnectionOptions(profile: Profile) {
  const separator = profile.uri.indexOf("?");
  const parameters = new Map(
    [
      ...new URLSearchParams(
        separator < 0 ? "" : profile.uri.slice(separator + 1),
      ),
    ].map(([key, value]) => [key.toLowerCase(), value]),
  );
  const option = (key: string, fallback: string): ConnectionOption =>
    parameters.has(key.toLowerCase())
      ? { value: parameters.get(key.toLowerCase())!, source: "uri" }
      : { value: fallback, source: "settings" };
  const tls: ConnectionOption =
    profile.provider === "cosmos"
      ? { value: "true", source: "provider" }
      : profile.tls
        ? { value: "true", source: "settings" }
        : parameters.has("tls")
          ? option("tls", "false")
          : parameters.has("ssl")
            ? option("ssl", "false")
            : {
                value: String(profile.uri.startsWith("mongodb+srv://")),
                source: "driver",
              };
  const retryWrites: ConnectionOption =
    profile.retryWrites !== undefined
      ? { value: String(profile.retryWrites), source: "settings" }
      : profile.provider === "cosmos"
        ? { value: "false", source: "provider" }
        : parameters.has("retrywrites")
          ? option("retryWrites", "true")
          : { value: "true", source: "driver" };
  return {
    authSource: option("authSource", profile.authSource),
    authMechanism: option("authMechanism", profile.authMechanism),
    replicaSet: option("replicaSet", profile.replicaSet),
    directConnection: profile.ssh.enabled
      ? { value: "true", source: "tunnel" as const }
      : option("directConnection", String(profile.directConnection)),
    readPreference: option("readPreference", profile.readPreference),
    w: option("w", profile.writeConcern),
    serverSelectionTimeoutMS: option(
      "serverSelectionTimeoutMS",
      String(profile.timeoutMS),
    ),
    connectTimeoutMS: option("connectTimeoutMS", String(profile.timeoutMS)),
    tls,
    retryWrites,
  };
}

const optionKeys: Partial<Record<keyof Profile, string[]>> = {
  authSource: ["authSource"],
  authMechanism: ["authMechanism"],
  replicaSet: ["replicaSet"],
  directConnection: ["directConnection"],
  readPreference: ["readPreference"],
  writeConcern: ["w"],
  timeoutMS: ["serverSelectionTimeoutMS", "connectTimeoutMS"],
  tls: ["tls", "ssl"],
};

/** A manual edit updates the URI too, so its previous value cannot silently win. */
export function updateConnectionOption<K extends keyof Profile>(
  profile: Profile,
  key: K,
  value: Profile[K],
): Profile {
  const keys = optionKeys[key];
  if (!keys) return { ...profile, [key]: value };
  const separator = profile.uri.indexOf("?");
  const base = separator < 0 ? profile.uri : profile.uri.slice(0, separator);
  const query = separator < 0 ? "" : profile.uri.slice(separator + 1);
  const parameters = new URLSearchParams(query);
  for (const existing of [...parameters.keys()])
    if (keys.some((key) => key.toLowerCase() === existing.toLowerCase()))
      parameters.delete(existing);
  if (value !== "" && value !== "DEFAULT")
    for (const parameter of key === "tls" ? ["tls"] : keys)
      parameters.set(parameter, String(value));
  const suffix = parameters.toString();
  return {
    ...profile,
    [key]: value,
    uri: `${base}${suffix ? `?${suffix}` : ""}`,
  };
}
