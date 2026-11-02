export function parseRouterEndpoint(config) {
  if (!config?.host || !config.username || !config.password) {
    throw new Error("Alamat router, username, dan password wajib diisi.");
  }

  const input = String(config.host).trim();
  let parsed;
  try {
    parsed = new URL(input.includes("://") ? input : `tcp://${input}`);
  } catch {
    throw new Error("Format IP/hostname router tidak valid.");
  }

  if (
    parsed.protocol !== "tcp:" || parsed.username || parsed.password ||
    (parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash
  ) {
    throw new Error("Isi IP/hostname dan port saja; jangan sertakan protokol, path, atau kredensial.");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const port = Number(config.apiPort || config.api_port || parsed.port || 8728);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Host atau port RouterOS API tidak valid.");
  }

  return {
    host,
    port,
    username: String(config.username).trim(),
    password: String(config.password),
  };
}
