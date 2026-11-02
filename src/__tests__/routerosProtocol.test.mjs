import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  challengeResponse,
  consumeSentences,
  decodeLength,
  encodeLength,
  encodeSentence,
  parseWord,
} from "../routerosProtocol.js";
import { RouterConnection, loginRouterOS } from "../routerosConnection.js";
import { parseRouterEndpoint } from "../routerosEndpoint.js";
import {
  calculateTrafficRate,
  formatTrafficRate,
  parseTrafficCounters,
  startSerialPolling,
  trafficInterfaceOptions,
  trafficLineSegments,
} from "../routerosTraffic.js";

test("RouterOS length encoding covers all variable-width boundaries", () => {
  for (const length of [0, 127, 128, 16383, 16384, 2097151, 2097152, 268435455, 268435456]) {
    const encoded = encodeLength(length);
    assert.deepEqual(decodeLength(encoded), { length, bytes: encoded.length });
  }
});

test("sentence decoder buffers fragmented words and keeps following frames", () => {
  const wire = Buffer.concat([
    encodeSentence(["!re", "=name=router-one", "=running=yes"]),
    encodeSentence(["!done"]),
  ]);
  let state = { buffer: Buffer.alloc(0), sentences: [] };
  state = consumeSentences(state.buffer, wire.subarray(0, 4));
  assert.equal(state.sentences.length, 0);
  state = consumeSentences(state.buffer, wire.subarray(4, 11));
  assert.equal(state.sentences.length, 0);
  state = consumeSentences(state.buffer, wire.subarray(11));
  assert.deepEqual(state.sentences, [
    ["!re", "=name=router-one", "=running=yes"],
    ["!done"],
  ]);
  assert.deepEqual(parseWord("=running=yes"), ["running", "true"]);
});

test("terminal !done word is decoded as text from complete and partial chunks", () => {
  const wire = encodeSentence(["!done"]);
  const complete = consumeSentences(Buffer.alloc(0), wire);
  assert.deepEqual(complete.sentences, [["!done"]]);
  assert.equal(typeof complete.sentences[0][0], "string");

  let partial = consumeSentences(Buffer.alloc(0), wire.subarray(0, 2));
  assert.deepEqual(partial.sentences, []);
  partial = consumeSentences(partial.buffer, wire.subarray(2, 4));
  assert.deepEqual(partial.sentences, []);
  partial = consumeSentences(partial.buffer, wire.subarray(4));
  assert.deepEqual(partial.sentences, [["!done"]]);
  assert.equal(typeof partial.sentences[0][0], "string");
});

test("legacy challenge response matches standard MD5 digest", () => {
  const password = "router-password";
  const challenge = "00112233445566778899aabbccddeeff";
  const expected = createHash("md5")
    .update(Buffer.concat([Buffer.from([0]), Buffer.from(password), Buffer.from(challenge, "hex")]))
    .digest("hex");
  assert.equal(challengeResponse(password, challenge), `00${expected}`);
});

test("host, dynamic forwarded port, and default API port are parsed correctly", () => {
  const credentials = { username: "api-user", password: "not-logged" };
  assert.deepEqual(
    parseRouterEndpoint({ ...credentials, host: "id-45.hostddns.us:10453" }),
    { host: "id-45.hostddns.us", port: 10453, ...credentials },
  );
  assert.equal(parseRouterEndpoint({ ...credentials, host: "192.168.88.1" }).port, 8728);
  assert.equal(parseRouterEndpoint({ ...credentials, host: "192.168.88.1", apiPort: "9000" }).port, 9000);
  assert.throws(() => parseRouterEndpoint({ ...credentials, host: "http://router.local" }));
});

class MockRouterSocket extends EventEmitter {
  constructor(respond) {
    super();
    this.respond = respond;
    this.requests = [];
  }

  write(payload, _encoding, callback) {
    callback();
    const frame = consumeSentences(Buffer.alloc(0), payload).sentences[0];
    this.requests.push(frame);
    const response = this.respond(frame, this.requests.length);
    if (response) setImmediate(() => this.emit("data", response));
  }

  destroy() {
    setImmediate(() => this.emit("close"));
  }
}

test("mock RouterOS legacy login exchanges challenge then authenticates", async () => {
  const challenge = "0123456789abcdef0123456789abcdef";
  const socket = new MockRouterSocket((_request, index) =>
    index === 1
      ? encodeSentence(["!done", `=ret=${challenge}`])
      : encodeSentence(["!done"]),
  );
  const connection = new RouterConnection(socket, "mock:8728");
  await loginRouterOS(connection, "api-user", "router-password");
  assert.deepEqual(socket.requests[0], ["/login", "=name=api-user", "=password=router-password"]);
  assert.deepEqual(socket.requests[1], [
    "/login",
    "=name=api-user",
    `=response=${challengeResponse("router-password", challenge)}`,
  ]);
  connection.close();
});

test("mock RouterOS modern login succeeds with a single response", async () => {
  const socket = new MockRouterSocket(() => encodeSentence(["!done"]));
  const connection = new RouterConnection(socket, "mock:8728");
  await loginRouterOS(connection, "api-user", "router-password");
  assert.equal(socket.requests.length, 1);
  connection.close();
});

test("login diagnostics identify success without logging authentication values", async () => {
  const socket = new MockRouterSocket(() => encodeSentence(["!done"]));
  const connection = new RouterConnection(socket, "mock:8728");
  const originalInfo = console.info;
  const messages = [];
  console.info = (...args) => messages.push(args);
  try {
    await loginRouterOS(connection, "diagnostic-user", "private-password");
  } finally {
    console.info = originalInfo;
  }
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /login succeeded/);
  assert.doesNotMatch(serialized, /private-password|diagnostic-user|response=|ret=/);
  connection.close();
});

test("mock RouterOS authentication trap is reported as credential rejection", async () => {
  const socket = new MockRouterSocket(() => Buffer.concat([
    encodeSentence(["!trap", "=message=invalid user name or password"]),
    encodeSentence(["!done"]),
  ]));
  const connection = new RouterConnection(socket, "mock:8728");
  await assert.rejects(
    loginRouterOS(connection, "bad-user", "bad-password"),
    (error) => error.code === "AUTH_REJECTED" && /username\/password/.test(error.message),
  );
  connection.close();
});

test("trap consumes its terminal !done before the following request", async () => {
  const socket = new MockRouterSocket((_request, index) => index === 1
    ? Buffer.concat([
      encodeSentence(["!trap", "=message=invalid user name or password"]),
      encodeSentence(["!done"]),
    ])
    : encodeSentence(["!done", "=identity=router-one"]));
  const connection = new RouterConnection(socket, "mock:8728");
  await assert.rejects(
    connection.request(["/login"], 100),
    (error) => error.code === "AUTH_REJECTED",
  );
  const next = await connection.request(["/system/identity/print"], 100);
  assert.deepEqual(next.attributes, { identity: "router-one" });
  assert.equal(socket.requests.length, 2);
  connection.close();
});

test("request is sent once and all reply sentences are consumed before the next request", async () => {
  const socket = new MockRouterSocket((request, index) => index === 1
    ? Buffer.concat([
      encodeSentence(["!re", "=name=router-one"]),
      encodeSentence(["!re", "=name=router-two"]),
      encodeSentence(["!done"]),
    ])
    : encodeSentence(["!done", "=next=yes"]));
  const connection = new RouterConnection(socket, "mock:8728");
  const first = await connection.request(["/system/identity/print"]);
  const second = await connection.request(["/system/resource/print"]);
  assert.equal(socket.requests.length, 2);
  assert.equal(first.replies.length, 2);
  assert.deepEqual(second.attributes, { next: "true" });
  connection.close();
});

test("RouterConnection accepts !done without attributes when delivered in partial chunks", async () => {
  const wire = encodeSentence(["!done"]);
  const socket = new MockRouterSocket(() => null);
  const connection = new RouterConnection(socket, "mock:8728");
  const resultPromise = connection.request(["/login"], 100);
  setImmediate(() => {
    socket.emit("data", wire.subarray(0, 2));
    socket.emit("data", wire.subarray(2, 4));
    socket.emit("data", wire.subarray(4));
  });
  const result = await resultPromise;
  assert.deepEqual(result, { replies: [], attributes: {} });
  connection.close();
});

test("timeout fails the connection and does not leave a reader for a later request", async () => {
  const socket = new MockRouterSocket(() => null);
  const connection = new RouterConnection(socket, "mock:8728");
  await assert.rejects(connection.request(["/slow"], 10), (error) => error.code === "NO_API_RESPONSE");
  assert.equal(connection.readers.length, 0);
  await assert.rejects(connection.request(["/later"], 10), (error) => error.code === "NO_API_RESPONSE");
  assert.equal(socket.requests.length, 1);
});

test("missing RouterOS response reports API-level timeout", async () => {
  const socket = new MockRouterSocket(() => null);
  const connection = new RouterConnection(socket, "mock:8728");
  await assert.rejects(
    connection.request(["/login"], 10),
    (error) => error.code === "NO_API_RESPONSE" && /RouterOS API/.test(error.message),
  );
});

test("non-RouterOS response is rejected instead of misreported as login failure", async () => {
  const socket = new MockRouterSocket(() => encodeSentence(["HTTP/1.1 200 OK"]));
  const connection = new RouterConnection(socket, "mock:8728");
  await assert.rejects(
    connection.request(["/login"], 100),
    (error) => error.code === "INVALID_RESPONSE" && /tidak dikenal/.test(error.message),
  );
  connection.close();
});

test("traffic counters are parsed from the selected actual interface", () => {
  const counters = parseTrafficCounters([
    { name: "ether1", "rx-byte": "1000", "tx-byte": "3000" },
    { name: "bridge1", "rx-byte": "2500", "tx-byte": "6000" },
  ], "bridge1");
  assert.deepEqual({ ...counters, sampledAt: 1 }, {
    interfaceName: "bridge1", rxBytes: 2500, txBytes: 6000, sampledAt: 1,
  });
  assert.throws(() => parseTrafficCounters([], "missing"), /tidak ditemukan/);
  assert.throws(() => parseTrafficCounters([{ name: "ether1" }], "ether1"), /Counter trafik RX\/TX/);
});

test("traffic counter deltas convert bytes per interval to bit rates", () => {
  assert.deepEqual(calculateTrafficRate(
    { rxBytes: 100, txBytes: 200, sampledAt: 1000 },
    { rxBytes: 1100, txBytes: 700, sampledAt: 2000 },
  ), { rx: 8000, tx: 4000 });
  assert.equal(calculateTrafficRate(null, { rxBytes: 1, txBytes: 1, sampledAt: 2000 }), null);
  assert.equal(formatTrafficRate(800), "800 bps");
  assert.equal(formatTrafficRate(12000), "12 Kbps");
  assert.equal(formatTrafficRate(1250000), "1.3 Mbps");
});

test("traffic interface choices are derived from router interfaces and line segments need history", () => {
  assert.deepEqual(trafficInterfaceOptions([
    { name: "ether1", running: "true" }, { running: "true" }, { name: "bridge1" },
  ]), [{ value: "ether1", label: "ether1" }, { value: "bridge1", label: "bridge1" }]);
  assert.equal(trafficLineSegments([{ rx: 1 }], "rx", 100, 50, 10).length, 0);
  assert.equal(trafficLineSegments([{ rx: 1 }, { rx: 2 }], "rx", 100, 50, 10).length, 1);
});

test("traffic polling is serial and cleanup prevents another scheduled poll", async () => {
  let calls = 0;
  let release;
  const firstPoll = new Promise((resolve) => { release = resolve; });
  const stop = startSerialPolling(async () => {
    calls += 1;
    if (calls === 1) await firstPoll;
  }, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  stop();
  release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 1);
});
