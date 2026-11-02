import AsyncStorage from "@react-native-async-storage/async-storage";
import TcpSocket from "react-native-tcp-socket";
import { NativeModules } from "react-native";
import { RouterApiError, RouterConnection, loginRouterOS } from "./routerosConnection.js";
import { parseRouterEndpoint } from "./routerosEndpoint.js";
import { parseTrafficCounters } from "./routerosTraffic.js";
import { reserveVoucherNames, buildHotspotProfilePatch, buildHotspotProfileLoginScript, buildHotspotProfileExpiryEvent, hotspotExpiredModeCode, parseHotspotProfileMetadata } from "./hotspotProfiles.js";
export { VOUCHER_CODE_ALPHABET, VOUCHER_CODE_LENGTH, VOUCHER_CODE_ATTEMPTS, createVoucherName, reserveVoucherNames, buildHotspotProfilePatch } from "./hotspotProfiles.js";

const ROUTER_CONFIG_KEY = "mikhmon_router_config";
const PPP_SERVICES = ["pppoe", "pptp", "l2tp", "sstp", "ovpn", "any"];
let activeSession = null;
let pendingSession = null;
let sessionGeneration = 0;

export const getRouterConfig = async () => {
  const value = await AsyncStorage.getItem(ROUTER_CONFIG_KEY);
  return value ? JSON.parse(value) : null;
};

export async function setRouterConfig(value) {
  if (value) {
    if (
      (activeSession && !sameRouter(activeSession.config, value)) ||
      (pendingSession && !sameRouter(pendingSession.config, value))
    ) {
      resetSession();
    }
    await AsyncStorage.setItem(ROUTER_CONFIG_KEY, JSON.stringify(value));
    return;
  }
  resetSession();
  await AsyncStorage.removeItem(ROUTER_CONFIG_KEY);
}

function resetSession() {
  sessionGeneration += 1;
  activeSession?.connection.close();
  activeSession = null;
  pendingSession = null;
}

function sameRouter(left, right) {
  if (!left || !right) return false;
  return left.host === right.host &&
    Number(left.apiPort || left.api_port || 8728) === Number(right.apiPort || right.api_port || 8728) &&
    left.username === right.username &&
    left.password === right.password;
}

function openSocket(endpoint) {
  if (!NativeModules?.TcpSockets) {
    throw new Error("Modul TCP native tidak tersedia. Instal APK hasil build native; Expo Go tidak mendukung koneksi RouterOS.");
  }

  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      reject(new RouterApiError(`Timeout membuka TCP ke ${endpoint.host}:${endpoint.port}.`, "CONNECT_TIMEOUT"));
    }, 12000);

    try {
      socket = TcpSocket.createConnection({
        host: endpoint.host,
        port: endpoint.port,
        connectTimeout: 10000,
      });
      socket.once("connect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        console.info("[RouterOS] TCP connected", { endpoint: `${endpoint.host}:${endpoint.port}` });
        resolve(socket);
      });
      socket.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const message = String(error?.message || "");
        if (/ENOTFOUND|EAI_AGAIN|UnknownHost|unable to resolve/i.test(message)) {
          reject(new RouterApiError(`Hostname ${endpoint.host} tidak dapat ditemukan DNS.`, "DNS_ERROR"));
          return;
        }
        if (/ECONNREFUSED|Connection refused/i.test(message)) {
          reject(new RouterApiError(`Koneksi ditolak oleh ${endpoint.host}:${endpoint.port}. Periksa layanan API dan port forwarding.`, "CONNECTION_REFUSED"));
          return;
        }
        reject(new RouterApiError(`Gagal membuka koneksi TCP ke ${endpoint.host}:${endpoint.port}: ${message || "kesalahan jaringan"}.`, "CONNECT_ERROR"));
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

async function connect(config) {
  const endpoint = parseRouterEndpoint(config);
  const socket = await openSocket(endpoint);
  const connection = new RouterConnection(socket, `${endpoint.host}:${endpoint.port}`);
  socket.once("close", () => {
    if (activeSession?.connection === connection) activeSession = null;
  });
  try {
    await loginRouterOS(connection, endpoint.username, endpoint.password);
    return {
      connection,
      config: {
        ...config,
        host: endpoint.host,
        apiPort: endpoint.port,
      },
    };
  } catch (error) {
    connection.close();
    if (error.code === "NO_API_RESPONSE") {
      throw new RouterApiError(
        `${error.message} Aplikasi menggunakan RouterOS API biasa (TCP), bukan API-SSL atau Winbox.`,
        error.code,
      );
    }
    if (error.code === "INVALID_FRAME") {
      throw new RouterApiError(
        `Respons dari ${endpoint.host}:${endpoint.port} bukan format RouterOS API. Periksa port dan pastikan tidak mengarah ke Winbox/API-SSL.`,
        error.code,
      );
    }
    throw error;
  }
}

async function getConnection(config) {
  if (activeSession && sameRouter(activeSession.config, config) && !activeSession.connection.failure) {
    return activeSession.connection;
  }
  if (pendingSession && sameRouter(pendingSession.config, config)) {
    return pendingSession.promise.then((opened) => opened.connection);
  }

  resetSession();
  const generation = sessionGeneration;
  const pending = { config, promise: connect(config) };
  pendingSession = pending;
  try {
    const opened = await pending.promise;
    if (generation !== sessionGeneration || pendingSession !== pending) {
      opened.connection.close();
      throw new Error("Konfigurasi router berubah saat koneksi sedang dibuat. Coba lagi.");
    }
    activeSession = opened;
    return opened.connection;
  } finally {
    if (pendingSession === pending) pendingSession = null;
  }
}

function commandFor(path, method, body) {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const id = ["PATCH", "DELETE"].includes(method) ? decodeURIComponent(parts.pop()) : null;
  const menu = `/${parts.join("/")}`;
  const attributes = Object.entries(body || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `=${key}=${value}`);
  if (method === "GET") return [`${menu}/print`];
  if (method === "DELETE") return [`${menu}/remove`, `=.id=${id}`];
  if (method === "PATCH") return [`${menu}/set`, `=.id=${id}`, ...attributes];
  return [`${menu}/add`, ...attributes];
}

async function ros(path, { method = "GET", body } = {}) {
  const config = await getRouterConfig();
  if (!config) throw new Error("Hubungkan router terlebih dahulu.");
  const connection = await getConnection(config);
  const result = await connection.request(commandFor(path, method, body));
  return method === "GET" ? result.replies : result.attributes;
}

async function rosSetResource(path, body = {}) {
  const config = await getRouterConfig();
  if (!config) throw new Error("Hubungkan router terlebih dahulu.");
  const connection = await getConnection(config);
  const attributes = Object.entries(body)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `=${key}=${value}`);
  const result = await connection.request([`/${path.replace(/^\/+/, "")}/set`, ...attributes]);
  return result.attributes;
}

async function rosAction(path, action, id) {
  const config = await getRouterConfig();
  if (!config) throw new Error("Hubungkan router terlebih dahulu.");
  const connection = await getConnection(config);
  const result = await connection.request([`/${path.replace(/^\/+/, "")}/${action}`, `=.id=${id}`]);
  return result.attributes;
}

async function rosBatch(paths) {
  const config = await getRouterConfig();
  if (!config) throw new Error("Hubungkan router terlebih dahulu.");
  const connection = await getConnection(config);
  return Promise.all(paths.map(async (path) =>
    (await connection.request([`/${path.replace(/^\/+/, "")}/print`])).replies,
  ));
}

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return null;
  const megabytes = bytes / 1024 / 1024;
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${megabytes.toFixed(0)} MB`;
};
const withoutPasswords = (items) => items.map(({ password, ...item }) => item);
const PPP_PROFILE_FIELDS = {
  localAddress: "local-address", remoteAddress: "remote-address", rateLimit: "rate-limit",
  onlyOne: "only-one", dnsServer: "dns-server", winsServer: "wins-server",
  changeTcpMss: "change-tcp-mss", useUpnp: "use-upnp", sessionTimeout: "session-timeout",
  idleTimeout: "idle-timeout", useIpv6: "use-ipv6", useMpls: "use-mpls",
  useCompression: "use-compression", useEncryption: "use-encryption", comment: "comment",
};
function buildPppProfileBody(body, includeEmpty = false) {
  const result = {};
  if (body.name !== undefined) result.name = body.name;
  for (const [source, target] of Object.entries(PPP_PROFILE_FIELDS)) {
    if (body[source] === undefined) continue;
    const value = body[source];
    if (includeEmpty || (value !== "" && value !== null)) result[target] = value;
  }
  return result;
}

async function syncHotspotProfileExpiry(profileName, oldName, form) {
  const schedulers = await ros("system/scheduler");
  const oldMarker = `Monitor Profile ${oldName || profileName}`;
  const marker = `Monitor Profile ${profileName}`;
  const existing = schedulers.find((item) => item.comment === oldMarker || item.comment === marker);
  const mode = hotspotExpiredModeCode(form.expiredMode);
  if (mode === "0") {
    if (existing?.[".id"]) await ros(`system/scheduler/${encodeURIComponent(existing[".id"])}`, { method: "DELETE" });
    return;
  }
  const randomBetween = (minimum, maximum) => minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  const startTime = `0${randomBetween(1, 5)}:${randomBetween(10, 59)}:${randomBetween(10, 59)}`;
  const interval = `00:02:${randomBetween(10, 59)}`;
  const schedulerBody = {
    name: profileName,
    "start-time": startTime,
    interval,
    "on-event": buildHotspotProfileExpiryEvent(profileName, mode),
    disabled: "no",
    comment: marker,
  };
  if (existing?.[".id"]) {
    await ros(`system/scheduler/${encodeURIComponent(existing[".id"])}`, { method: "PATCH", body: schedulerBody });
  } else {
    await ros("system/scheduler", { method: "POST", body: schedulerBody });
  }
}

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};
  const route = new URL(path, "http://router.local").pathname;

  if (route === "/health") return { ok: true, service: "router-direct" };
  if (route === "/api/config") {
    return { pppServices: PPP_SERVICES.map((value) => ({ value, label: value.toUpperCase() })) };
  }

  if (route === "/api/routers/test" && method === "POST") {
    const { connection, config } = await connect(body);
    try {
      const identity = await connection.request(["/system/identity/print"]);
      config.name = identity.replies[0]?.name || "MikroTik";
      if (activeSession && activeSession.connection !== connection) {
        activeSession.connection.close();
      }
      activeSession = null;
      pendingSession = null;
      sessionGeneration += 1;
      await setRouterConfig(config);
      activeSession = { connection, config };
      return { connected: true, identity: config.name, routerConfig: config };
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  if (route === "/api/routers/discover" && method === "POST") {
    const { connection } = await connect(body);
    try {
      const result = await connection.request(["/ip/neighbor/print"]);
      return result.replies.map((item) => ({
        identity: item.identity || item["system-identity"] || "",
        address: item.address || item["ipv4-address"] || "",
        macAddress: item["mac-address"] || "",
        platform: item.platform || "",
        version: item.version || "",
        interface: item.interface || "",
        board: item["board"] || "",
      }));
    } finally {
      connection.close();
    }
  }

  if (route === "/api/dashboard") {
    const config = await getRouterConfig();
    if (!config) throw new Error("Hubungkan router terlebih dahulu.");
    const connection = await getConnection(config);
    {
      const commands = [
        "system/identity",
        "system/resource",
        "ppp/secret",
        "ppp/active",
        "interface",
      ];
      const results = await Promise.all(commands.map(async (command) =>
        (await connection.request([`/${command}/print`])).replies,
      ));
      const [identities, resources, secrets, active, interfaces] = results;
      const hotspotUsers = await connection.request(["/ip/hotspot/user/print"]).then((result) => result.replies).catch(() => null);
      const hotspotActive = await connection.request(["/ip/hotspot/active/print"]).then((result) => result.replies).catch(() => null);
      const identity = identities[0] || {};
      const resource = resources[0] || {};
      const memoryTotal = Number(resource["total-memory"] || 0);
      const memoryFree = Number(resource["free-memory"] || 0);
      return {
        identity: identity.name || null,
        router: identity.name || null,
        boardName: resource["board-name"] || null,
        architecture: resource["architecture-name"] || null,
        version: resource.version || null,
        uptime: resource.uptime || null,
        cpuLoad: resource["cpu-load"] ?? null,
        freeMemory: formatBytes(memoryFree),
        totalMemory: formatBytes(memoryTotal),
        memoryUsedPercent: memoryTotal > 0 ? Math.round(((memoryTotal - memoryFree) / memoryTotal) * 100) : null,
        traffic: { rx: null, tx: null, ready: false, activeInterfaces: 0 },
        activeInterfaces: interfaces.filter((item) => item.running === "true").length,
        totalInterfaces: interfaces.length,
        totalSecrets: secrets.length,
        totalHotspotUsers: hotspotUsers?.length ?? null,
        activeHotspot: hotspotActive?.length ?? null,
        active: active.length,
        interfaces,
      };
    }
  }

  if (route === "/api/traffic") {
    const interfaces = await ros("interface");
    const active = interfaces.filter((item) => item.running === "true");
    const requestedName = new URL(path, "http://router.local").searchParams.get("interface");
    const selected = requestedName
      ? interfaces.find((item) => item.name === requestedName)
      : active[0];
    if (!selected) {
      throw new Error(requestedName
        ? `Interface ${requestedName} tidak ditemukan pada router.`
        : "Tidak ada interface aktif yang dapat dipantau.");
    }
    return { ...parseTrafficCounters([selected], selected.name), activeInterfaces: active.length };
  }

  if (route === "/api/router/interfaces" && method === "GET") return ros("interface");
  if (route.startsWith("/api/router/interfaces/") && method === "PATCH") {
    const id = decodeURIComponent(route.split("/").pop());
    await ros(`interface/${id}`, { method, body: { disabled: String(!body.enabled) } });
    return { ok: true };
  }

  if (route === "/api/ppp/secrets") {
    if (method === "GET") return ros("ppp/secret");
    await ros("ppp/secret", {
      method: "POST",
      body: {
        name: body.name,
        password: body.password,
        service: body.service,
        profile: body.profile,
        ...(body.localAddress ? { "local-address": body.localAddress } : {}),
        ...(body.remoteAddress ? { "remote-address": body.remoteAddress } : {}),
        ...(body.comment ? { comment: body.comment } : {}),
      },
    });
    return { ok: true };
  }
  if (route === "/api/ppp/active") return ros("ppp/active");
  if (route === "/api/ppp/profiles") {
    if (method === "GET") return ros("ppp/profile");
    if (method === "POST") {
      const pppProfileBody = buildPppProfileBody(body);
      await ros("ppp/profile", { method: "POST", body: pppProfileBody });
      return { ok: true };
    }
  }
  if (route.startsWith("/api/ppp/profiles/")) {
    const id = decodeURIComponent(route.split("/").pop());
    if (method === "DELETE") {
      await ros(`ppp/profile/${id}`, { method: "DELETE" });
      return { ok: true };
    }
    if (method === "PATCH") {
      const patch = buildPppProfileBody(body, true);
      await ros(`ppp/profile/${id}`, { method: "PATCH", body: patch });
      return { ok: true };
    }
  }
  if (route.startsWith("/api/ppp/secrets/")) {
    const id = decodeURIComponent(route.split("/").pop());
    if (method === "DELETE") {
      await ros(`ppp/secret/${id}`, { method });
      return { ok: true };
    }
    await ros(`ppp/secret/${id}`, {
      method,
      body: method === "PATCH" ? {
        name: body.name,
        ...(body.password ? { password: body.password } : {}),
        service: body.service,
        profile: body.profile,
        ...(body.localAddress !== undefined ? { "local-address": body.localAddress || "" } : {}),
        ...(body.remoteAddress !== undefined ? { "remote-address": body.remoteAddress || "" } : {}),
        comment: body.comment || "",
      } : undefined,
    });
    return { ok: true };
  }
  if (route.startsWith("/api/ppp/active/")) {
    await ros(`ppp/active/${decodeURIComponent(route.split("/").pop())}`, { method: "DELETE" });
    return { ok: true };
  }

  if (route === "/api/hotspot/users") {
    if (method === "GET") return withoutPasswords(await ros("ip/hotspot/user"));
    if (method === "POST") {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("Username wajib diisi.");
      if (!body.profile) throw new Error("Pilih profile Hotspot.");
      const limitBytes = Number(body.limitBytesTotal || 0);
      if (!Number.isFinite(limitBytes) || limitBytes < 0) throw new Error("Data limit tidak valid.");
      await ros("ip/hotspot/user", {
        method,
        body: {
          name,
          password: body.password || "",
          server: body.server || "all",
          profile: body.profile,
          ...(body.duration ? { "limit-uptime": body.duration } : {}),
          ...(limitBytes > 0 ? { "limit-bytes-total": Math.round(limitBytes) } : {}),
          ...(body.comment ? { comment: body.comment } : {}),
        },
      });
      return { ok: true };
    }
  }
  if (route === "/api/hotspot/active") return ros("ip/hotspot/active");
  if (route === "/api/hotspot/servers") return ros("ip/hotspot/server");
  if (route === "/api/hotspot/address-pools") return ros("ip/pool");
  if (route === "/api/router/queues") return ros("queue/simple");
  if (route === "/api/ip/dns") {
    if (method === "GET") return ros("ip/dns");
    if (method === "PATCH") return rosSetResource("ip/dns", body);
  }
  if (route === "/api/ip/dhcp-clients") {
    if (method === "GET") return ros("ip/dhcp-client");
    if (method === "POST") return ros("ip/dhcp-client", { method, body });
  }
  if (route.startsWith("/api/ip/dhcp-clients/")) {
    const parts = route.split("/").filter(Boolean);
    const action = parts[parts.length - 1];
    const id = decodeURIComponent(parts[parts.length - (["release", "renew"].includes(action) ? 2 : 1)]);
    if (["release", "renew"].includes(action)) return rosAction("ip/dhcp-client", action, id);
    if (method === "DELETE") return ros(`ip/dhcp-client/${encodeURIComponent(id)}`, { method });
    if (method === "PATCH") return ros(`ip/dhcp-client/${encodeURIComponent(id)}`, { method, body });
  }
  if (route === "/api/ip/pools") {
    if (method === "GET") return ros("ip/pool");
    if (method === "POST") return ros("ip/pool", { method, body });
  }
  if (route.startsWith("/api/ip/pools/")) {
    const id = decodeURIComponent(route.split("/").pop());
    if (method === "DELETE") return ros(`ip/pool/${encodeURIComponent(id)}`, { method });
    if (method === "PATCH") return ros(`ip/pool/${encodeURIComponent(id)}`, { method, body });
  }
  if (route === "/api/hotspot/profiles") {
    if (method === "GET") return ros("ip/hotspot/user/profile");
    if (method === "POST") {
      const profileBody = buildHotspotProfilePatch(body);
      const profileForm = { ...body, name: profileBody.name };
      profileBody["on-login"] = buildHotspotProfileLoginScript(profileForm);
      await ros("ip/hotspot/user/profile", { method, body: profileBody });
      await syncHotspotProfileExpiry(profileForm.name, "", profileForm);
      return { ok: true };
    }
  }
  if (route.startsWith("/api/hotspot/profiles/")) {
    const id = decodeURIComponent(route.split("/").pop());
    if (method === "DELETE") {
      const profiles = await ros("ip/hotspot/user/profile");
      const profile = profiles.find((item) => item[".id"] === id || item.name === id);
      if (!profile) throw new Error("Profil Hotspot tidak ditemukan pada router.");
      await ros(`ip/hotspot/user/profile/${encodeURIComponent(profile[".id"])}`, { method: "DELETE" });
      const schedulers = await ros("system/scheduler").catch(() => []);
      const marker = `Monitor Profile ${profile.name}`;
      const scheduler = schedulers.find((item) => item.comment === marker);
      if (scheduler?.[".id"]) await ros(`system/scheduler/${encodeURIComponent(scheduler[".id"])}`, { method: "DELETE" });
      return { ok: true };
    }
    if (method === "GET") {
      const profiles = await ros("ip/hotspot/user/profile");
      const profile = profiles.find((item) => item[".id"] === id || item.name === id);
      if (!profile) throw new Error("Profil Hotspot tidak ditemukan pada router.");
      return { ...profile, ...parseHotspotProfileMetadata(profile["on-login"]) };
    }
    if (method === "PATCH") {
      const profiles = await ros("ip/hotspot/user/profile");
      const original = profiles.find((item) => item[".id"] === id);
      if (!original) throw new Error("Profil Hotspot tidak ditemukan pada router.");
      const patch = buildHotspotProfilePatch(body, original);
      const profileForm = { ...body, name: patch.name || original.name };
      const routerMetadata = parseHotspotProfileMetadata(original["on-login"]);
      const hasManagedMetadata = Object.keys(routerMetadata).length > 0;
      const hasMetadataInput = [body.expiredMode, body.validity, body.price, body.sellingPrice].some((value) => String(value || "").trim()) || body.lockUser === "enable";
      if (hasManagedMetadata || hasMetadataInput) patch["on-login"] = buildHotspotProfileLoginScript(profileForm);
      await ros(`ip/hotspot/user/profile/${encodeURIComponent(id)}`, { method, body: patch });
      await syncHotspotProfileExpiry(profileForm.name, original.name, profileForm);
      return { ok: true };
    }
  }
  if (route === "/api/hotspot/vouchers" && method === "POST") {
    const quantity = Number(body.count);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error("Jumlah voucher harus antara 1 dan 100.");
    }
    if (!/^\d+[smhdw]$/.test(body.duration || "")) {
      throw new Error("Durasi harus memakai format angka diikuti s, m, h, d, atau w.");
    }
    const profiles = await ros("ip/hotspot/user/profile");
    const sourceProfile = profiles.find((item) => item.name === body.profile);
    if (!sourceProfile) {
      throw new Error("Profil Hotspot tidak ditemukan pada router.");
    }
    const limitUsers = Number(body.limitUsers || 1);
    if (!Number.isInteger(limitUsers) || limitUsers < 1 || limitUsers > 100) {
      throw new Error("Batas perangkat harus berupa bilangan bulat antara 1 dan 100.");
    }
    let voucherProfile = body.profile;
    if (Number(sourceProfile["shared-users"] || 1) !== limitUsers) {
      const marker = "Dibuat otomatis untuk limit perangkat voucher";
      const safeSource = body.profile.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 20);
      voucherProfile = `APP-${safeSource}-${limitUsers}`;
      const managedProfile = profiles.find((item) => item.name === voucherProfile);
      if (managedProfile && managedProfile.comment !== marker) {
        throw new Error(`Nama profile ${voucherProfile} sudah dipakai profile lain.`);
      }
      if (!managedProfile) {
        const profileFields = Object.fromEntries(
          Object.entries(sourceProfile).filter(([key]) =>
            !key.startsWith(".") && !["name", "default", "dynamic", "comment"].includes(key),
          ),
        );
        await ros("ip/hotspot/user/profile", {
          method: "POST",
          body: {
            ...profileFields,
            name: voucherProfile,
            "shared-users": String(limitUsers),
            comment: marker,
          },
        });
      }
    }
    const existingUsers = await ros("ip/hotspot/user");
    const nameLength = Number(body.nameLength || 4);
    const alphabet = [...new Set(String(body.characters || "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"))].join("");
    const prefix = String(body.prefix || "");
    if (!Number.isInteger(nameLength) || nameLength < 1 || nameLength > 16) throw new Error("Panjang nama harus antara 1 dan 16 karakter.");
    if (!alphabet.length || !/^[a-zA-Z0-9]+$/.test(alphabet)) throw new Error("Karakter voucher harus berisi huruf dan/atau angka.");
    if (prefix && !/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Prefix hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung.");
    const makeName = () => {
      let code = "";
      for (let index = 0; index < nameLength; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      return `${prefix}${code}`;
    };
    const names = reserveVoucherNames(quantity, existingUsers.map((item) => item.name).filter(Boolean), makeName);
    const items = [];
    for (let index = 0; index < quantity; index += 1) {
      const name = names[index];
      if (existingUsers.some((item) => item.name === name) || items.some((item) => item.name === name)) {
        throw new Error(`Nama voucher ${name} sudah digunakan.`);
      }
      const password = body.userMode === "username" ? "" : name;
      await ros("ip/hotspot/user", {
        method: "POST",
        body: {
          name,
          password,
          profile: voucherProfile,
          server: body.server || "all",
          "limit-uptime": body.duration,
          ...(Number(body.limitBytesTotal) > 0 ? { "limit-bytes-total": body.limitBytesTotal } : {}),
          ...(body.comment ? { comment: body.comment } : {}),
        },
      });
      items.push({ name, password, profile: voucherProfile, "limit-uptime": body.duration });
    }
    return { items };
  }
  if (route.startsWith("/api/hotspot/users/")) {
    const id = decodeURIComponent(route.split("/").pop());
    if (method === "DELETE") {
      await ros(`ip/hotspot/user/${id}`, { method });
      return { ok: true };
    }
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.password) patch.password = body.password;
    if (body.profile !== undefined) patch.profile = body.profile;
    if (body.duration !== undefined) patch["limit-uptime"] = body.duration;
    if (body.comment !== undefined) patch.comment = body.comment;
    if (body.server !== undefined) patch.server = body.server;
    await ros(`ip/hotspot/user/${id}`, { method, body: patch });
    return { ok: true };
  }

  throw new Error(`Operasi belum didukung: ${method} ${route}`);
}
