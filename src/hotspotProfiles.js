export const VOUCHER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const VOUCHER_CODE_LENGTH = 4;
export const VOUCHER_CODE_ATTEMPTS = 40;

export function createVoucherName(random = Math.random, length = VOUCHER_CODE_LENGTH, alphabet = VOUCHER_CODE_ALPHABET, prefix = "") {
  let name = "";
  for (let index = 0; index < length; index += 1) {
    name += alphabet[Math.floor(random() * alphabet.length)];
  }
  return `${prefix}${name}`;
}

export function reserveVoucherNames(quantity, existingNames, createName = createVoucherName, maxAttempts = VOUCHER_CODE_ATTEMPTS) {
  const used = new Set(existingNames);
  const capacity = VOUCHER_CODE_ALPHABET.length ** VOUCHER_CODE_LENGTH;
  if (used.size + quantity > capacity) throw new Error("Kombinasi kode voucher empat karakter sudah tidak mencukupi.");
  const names = [];
  for (let index = 0; index < quantity; index += 1) {
    let candidate = "";
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const generated = createName();
      if (typeof generated === "string" && /^[a-zA-Z0-9_-]+$/.test(generated) && !used.has(generated)) {
        candidate = generated;
        break;
      }
    }
    if (!candidate) throw new Error("Kode voucher unik tidak berhasil dibuat setelah beberapa percobaan. Coba lagi.");
    used.add(candidate);
    names.push(candidate);
  }
  return names;
}

export function buildHotspotProfilePatch(form, original = {}) {
  const patch = {};
  const name = String(form.name || "").trim().replace(/\s+/g, "-");
  if (!name) throw new Error("Nama profil wajib diisi.");
  if (name !== original.name) patch.name = name;
  for (const key of ["session-timeout", "idle-timeout", "shared-users", "rate-limit", "address-pool", "parent-queue"]) {
    const value = String(form[key] ?? "").trim();
    if (value && value !== String(original[key] ?? "")) patch[key] = value;
  }
  return patch;
}

export function hotspotExpiredModeCode(mode) {
  return ({ remove: "rem", notice: "ntf", "remove-record": "remc", "notice-record": "ntfc", none: "0", "": "0" })[mode] || mode;
}

function quoteRouterOS(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildHotspotProfileLoginScript(form) {
  const mode = hotspotExpiredModeCode(form.expiredMode);
  const validity = String(form.validity || "").trim();
  const price = String(form.price || "0").trim() || "0";
  const sellingPrice = String(form.sellingPrice || "0").trim() || "0";
  const lock = form.lockUser === "enable"
    ? '; :local mac $"mac-address"; /ip hotspot user set mac-address=$mac [find where name=$user]'
    : "";
  if (mode === "0") {
    return validity || price !== "0" || sellingPrice !== "0"
      ? `:put (",0,${price},${validity},${sellingPrice},,${form.lockUser === "enable" ? "Enable" : "Disable"},")${lock}`
      : "";
  }
  if (!validity) throw new Error("Validity wajib diisi jika Expired Mode aktif.");
  if (!/^\d+[smhdw]$/.test(validity)) throw new Error("Validity harus memakai format angka diikuti s, m, h, d, atau w.");
  const record = ["remove-record", "notice-record"].includes(form.expiredMode)
    ? `; :local mac $\"mac-address\"; :local time [/system clock get time]; /system script add name=\"$date-|-$time-|-$user-|-${price}-|-$address-|-$mac-|-${validity}-|-${quoteRouterOS(form.name)}-|-$comment\" owner=\"$month$year\" source=\"$date\" comment=\"mikhmon\"`
    : "";
  const onLoginExpiry = `:local comment [/ip hotspot user get [/ip hotspot user find where name=\"$user\"] comment]; :local ucode [:pic $comment 0 2]; :if ($ucode = \"vc\" or $ucode = \"up\" or $comment = \"\") do={ :local date [/system clock get date]; :local year [:pick $date 7 11]; :local month [:pick $date 0 3]; /system scheduler add name=\"$user\" disable=no start-date=$date interval=\"${validity}\"; :delay 5s; :local exp [/system scheduler get [/system scheduler find where name=\"$user\"] next-run]; :local getxp [:len $exp]; :if ($getxp = 15) do={ :local d [:pick $exp 0 6]; :local t [:pick $exp 7 16]; :local slash \"/\"; :local exp (\"$d$slash$year $t\"); /ip hotspot user set comment=\"$exp\" [find where name=\"$user\"]; }; :if ($getxp = 8) do={ /ip hotspot user set comment=\"$date $exp\" [find where name=\"$user\"]; }; :if ($getxp > 15) do={ /ip hotspot user set comment=\"$exp\" [find where name=\"$user\"]; }; :delay 5s; /system scheduler remove [find where name=\"$user\"]; ${record}${lock} }`;
  return `:put (\",${mode},${price},${validity},${sellingPrice},,${form.lockUser === "enable" ? "Enable" : "Disable"},\"); {${onLoginExpiry} }`;
}

export function parseHotspotProfileMetadata(onLogin = "") {
  const match = String(onLogin).match(/:put\s*\(\s*"([^"]*)"\s*\)/);
  if (!match) return {};
  const fields = match[1].split(",");
  if (fields[5] === "noexp") {
    return {
      expiredMode: "none",
      price: fields[2] || "0",
      validity: "",
      sellingPrice: fields[6] || "0",
      lockUser: String(fields[8] || "").toLowerCase() === "enable" ? "enable" : "disable",
    };
  }
  const rawMode = fields[1] || "0";
  const price = fields[2] || "0";
  const validity = fields[3] || "";
  const sellingPrice = fields[4] || "0";
  const lock = fields[6] || "";
  const expiredMode = ({ rem: "remove", ntf: "notice", remc: "remove-record", ntfc: "notice-record", "": "none", "0": "none" })[rawMode] || "none";
  return { expiredMode, price, validity, sellingPrice, lockUser: lock.toLowerCase() === "enable" ? "enable" : "disable" };
}

export function buildHotspotProfileExpiryEvent(profileName, mode) {
  const action = ["rem", "remc"].includes(hotspotExpiredModeCode(mode)) ? "remove" : "set limit-uptime=1s";
  const profile = quoteRouterOS(profileName);
  return `:local dateint do={:local montharray (\"jan\",\"feb\",\"mar\",\"apr\",\"may\",\"jun\",\"jul\",\"aug\",\"sep\",\"oct\",\"nov\",\"dec\"); :local days [:pick $d 4 6]; :local month [:pick $d 0 3]; :local year [:pick $d 7 11]; :local monthint [:find $montharray $month]; :local month ($monthint + 1); :if ([:len $month] = 1) do={:local zero \"0\"; :return [:tonum (\"$year$zero$month$days\")];} else={:return [:tonum (\"$year$month$days\")];}}; :local timeint do={:local hours [:pick $t 0 2]; :local minutes [:pick $t 3 5]; :return ($hours * 60 + $minutes);}; :local date [/system clock get date]; :local time [/system clock get time]; :local today [$dateint d=$date]; :local curtime [$timeint t=$time]; :foreach i in [/ip hotspot user find where profile=\"${profile}\"] do={:local comment [/ip hotspot user get $i comment]; :local name [/ip hotspot user get $i name]; :local gettime [:pick $comment 12 20]; :if ([:pick $comment 3] = \"/\" and [:pick $comment 6] = \"/\") do={:local expd [$dateint d=$comment]; :local expt [$timeint t=$gettime]; :if (($expd < $today) or ($expd = $today and $expt < $curtime)) do={[/ip hotspot user ${action} $i]; /ip hotspot active remove [find where user=$name];}}}`;
}
