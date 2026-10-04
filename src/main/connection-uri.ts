import { ConnectionString } from "mongodb-connection-string-url";
import type { Profile, Secrets } from "../shared/contracts";
import { effectiveConnectionOptions } from "../shared/connection-options";

export type UriExport = { uri: string; omissions: string[] };

function setOption(uri: ConnectionString, key: string, value?: string) {
  for (const existing of [...uri.searchParams.keys()])
    if (existing.toLowerCase() === key.toLowerCase())
      uri.searchParams.delete(existing);
  if (value === undefined || value === "") uri.searchParams.delete(key);
  else uri.searchParams.set(key, value);
}

/** Builds a portable MongoDB URI from the actual saved connection settings. */
export function exportMongoUri(
  profile: Profile,
  secrets: Secrets,
  includePassword: boolean,
): UriExport {
  const uri = new ConnectionString(profile.uri);
  uri.pathname = `/${encodeURIComponent(profile.database)}`;
  uri.username = profile.username;
  uri.password = includePassword ? secrets.password || "" : "";
  const effective = effectiveConnectionOptions(profile);
  for (const [key, option] of Object.entries(effective))
    setOption(uri, key, option.value === "DEFAULT" ? undefined : option.value);
  uri.searchParams.delete("ssl");
  const omissions = [
    profile.caFile && "CA certificate file",
    profile.certFile && "client certificate file",
    profile.ssh.enabled && "SSH tunnel",
  ].filter(Boolean) as string[];
  return { uri: uri.toString(), omissions };
}
