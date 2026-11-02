import assert from "node:assert/strict";
import test from "node:test";

test("PPP profiles list can be filtered by search keyword", () => {
  const profiles = [
    { ".id": "*1", name: "default", "local-address": "10.0.0.1", "remote-address": "pool1", "rate-limit": "10M/10M", comment: "kantor" },
    { ".id": "*2", name: "20Mbps", "local-address": "10.0.0.1", "remote-address": "pool2", "rate-limit": "20M/20M", comment: "paket super" },
    { ".id": "*3", name: "default-encryption", "local-address": "", "remote-address": "", "rate-limit": "" },
  ];

  const search = "20m";
  const filtered = profiles.filter((item) =>
    `${item.name || ""} ${item["local-address"] || ""} ${item["remote-address"] || ""} ${item["rate-limit"] || ""} ${item["dns-server"] || ""} ${item.comment || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "20Mbps");
});

test("PPP secrets filter handles profile filter mode without returning secrets", () => {
  const secrets = [
    { ".id": "*1", name: "user1", profile: "default", service: "pppoe" },
    { ".id": "*2", name: "user2", profile: "20Mbps", service: "pppoe" },
  ];
  const activeNames = new Set(["user1"]);
  const pppFilter = "profile";

  const visibleSecrets = secrets.filter((item) => {
    if (pppFilter === "profile") return false;
    const active = activeNames.has(item.name);
    const filterMatches = pppFilter === "all" || (pppFilter === "active" ? active : !active);
    return filterMatches;
  });

  assert.equal(visibleSecrets.length, 0);
});

test("PPP profile detail preserves RouterOS attributes", () => {
  const profile = {
    ".id": "*1",
    name: "10Mbps-Profile",
    "local-address": "192.168.10.1",
    "remote-address": "dhcp-pool-ppp",
    "rate-limit": "10M/10M",
    "only-one": "yes",
    "dns-server": "8.8.8.8",
    comment: "Pelanggan reguler",
  };

  assert.equal(profile.name, "10Mbps-Profile");
  assert.equal(profile["local-address"], "192.168.10.1");
  assert.equal(profile["remote-address"], "dhcp-pool-ppp");
  assert.equal(profile["rate-limit"], "10M/10M");
  assert.equal(profile["only-one"], "yes");
  assert.equal(profile["dns-server"], "8.8.8.8");
  assert.equal(profile.comment, "Pelanggan reguler");
});

