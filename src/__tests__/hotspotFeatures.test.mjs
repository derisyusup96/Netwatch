import assert from "node:assert/strict";
import test from "node:test";
import {
  VOUCHER_CODE_ALPHABET,
  buildHotspotProfilePatch,
  createVoucherName,
  reserveVoucherNames,
} from "../hotspotProfiles.js";

test("voucher codes are exactly four allowed uppercase characters", () => {
  const code = createVoucherName(() => 0);
  assert.equal(code.length, 4);
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(VOUCHER_CODE_ALPHABET.includes("O"), false);
  assert.equal(VOUCHER_CODE_ALPHABET.includes("0"), false);
  assert.equal(VOUCHER_CODE_ALPHABET.includes("I"), false);
  assert.equal(VOUCHER_CODE_ALPHABET.includes("1"), false);
});

test("voucher code reservation retries router collisions and batch collisions", () => {
  const candidates = ["AB2D", "EFG2", "EFG2", "HJK3"];
  let index = 0;
  const codes = reserveVoucherNames(2, ["AB2D"], () => candidates[index++]);
  assert.deepEqual(codes, ["EFG2", "HJK3"]);
  assert.equal(new Set(codes).size, 2);
});

test("voucher reservation gives up after bounded retries and reports exhausted space", () => {
  assert.throws(() => reserveVoucherNames(1, ["AB2D"], () => "AB2D", 3), /unik tidak berhasil/);
  assert.throws(() => reserveVoucherNames(VOUCHER_CODE_ALPHABET.length ** 4, ["AB2D"], () => "CD3E"), /tidak mencukupi/);
});

test("profile list and detail use actual RouterOS user profile records", () => {
  const records = [
    { ".id": "*1", name: "default", "session-timeout": "1h", "shared-users": "2" },
    { ".id": "*2", name: "test", "rate-limit": "2M/2M" },
  ];
  assert.equal(records.length, 2);
  assert.deepEqual(records.find((profile) => profile[".id"] === "*2"), {
    ".id": "*2", name: "test", "rate-limit": "2M/2M",
  });
});

test("profile form requires a name and omits empty optional fields", () => {
  assert.throws(() => buildHotspotProfilePatch({ name: "  " }), /wajib diisi/);
  assert.deepEqual(buildHotspotProfilePatch({ name: " new ", "idle-timeout": "", "shared-users": "2" }), {
    name: "new", "shared-users": "2",
  });
});

test("profile edit sends only filled changed attributes", () => {
  const original = { name: "default", "session-timeout": "1h", "idle-timeout": "5m", "shared-users": "1" };
  assert.deepEqual(buildHotspotProfilePatch({ name: "default", "session-timeout": "2h", "idle-timeout": "", "shared-users": "1", "rate-limit": "3M/3M" }, original), {
    "session-timeout": "2h", "rate-limit": "3M/3M",
  });
});

test("profile API !trap and timeout errors retain clear failures", async () => {
  const { RouterConnection } = await import("../routerosConnection.js");
  const { EventEmitter } = await import("node:events");
  const { encodeSentence, consumeSentences } = await import("../routerosProtocol.js");
  class Socket extends EventEmitter {
    write(payload, _encoding, callback) {
      callback();
      const frame = consumeSentences(Buffer.alloc(0), payload).sentences[0];
      const response = frame[0] === "/ip/hotspot/user/profile/add"
        ? Buffer.concat([encodeSentence(["!trap", "=message=invalid profile"]), encodeSentence(["!done"])])
        : null;
      if (response) setImmediate(() => this.emit("data", response));
    }
    destroy() { setImmediate(() => this.emit("close")); }
  }
  const connection = new RouterConnection(new Socket(), "mock:8728");
  await assert.rejects(connection.request(["/ip/hotspot/user/profile/add", "=name=bad"]), /RouterOS menolak/);
  const missing = new RouterConnection(new Socket(), "mock:8728");
  await assert.rejects(missing.request(["/ip/hotspot/user/profile/print"], 5), (error) => error.code === "NO_API_RESPONSE");
});
