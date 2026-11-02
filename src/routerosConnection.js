import { Buffer } from "buffer";
import {
  challengeResponse,
  consumeSentences,
  encodeSentence,
  parseWord,
} from "./routerosProtocol.js";

export class RouterApiError extends Error {
  constructor(message, code = "ROUTER_API_ERROR") {
    super(message);
    this.name = "RouterApiError";
    this.code = code;
  }
}

export class RouterConnection {
  constructor(socket, endpoint) {
    this.socket = socket;
    this.endpoint = endpoint;
    this.buffer = Buffer.alloc(0);
    this.readers = [];
    this.sentences = [];
    this.pending = Promise.resolve();
    this.failure = null;
    socket.on("data", (chunk) => {
      try {
        const result = consumeSentences(this.buffer, chunk);
        this.buffer = result.buffer;
        for (const sentence of result.sentences) {
          const reader = this.readers.shift();
          if (reader) reader.resolve(sentence);
          else this.sentences.push(sentence);
        }
      } catch (error) {
        this.fail(new RouterApiError(error.message, "INVALID_FRAME"));
      }
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () =>
      this.fail(new RouterApiError("Koneksi RouterOS ditutup sebelum respons lengkap diterima.", "CONNECTION_CLOSED")),
    );
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    while (this.readers.length) this.readers.shift().reject(error);
  }

  read() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.sentences.length) return Promise.resolve(this.sentences.shift());
    return new Promise((resolve, reject) => {
      this.readers.push({ resolve, reject });
    });
  }

  request(words, timeoutMs = 10000) {
    const job = this.pending.then(() => this.talk(words, timeoutMs));
    this.pending = job.then(() => undefined, () => undefined);
    return job;
  }

  async talk(words, timeoutMs) {
    if (this.failure) throw this.failure;
    const replies = [];
    let trapError = null;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RouterApiError(
        `Tidak ada balasan RouterOS API dari ${this.endpoint}. Paket API sudah dikirim, tetapi router tidak membalas. Pastikan port menuju layanan RouterOS API biasa, bukan Winbox atau API-SSL.`,
        "NO_API_RESPONSE",
      )), timeoutMs);
    });
    try {
      let pendingRead = this.read();
      await new Promise((resolve, reject) => {
        this.socket.write(encodeSentence(words), "binary", (error) => error ? reject(error) : resolve());
      });
      while (true) {
        const sentence = await Promise.race([pendingRead, deadline]);
        const kind = sentence[0];
        const attributes = Object.fromEntries(sentence.slice(1).map(parseWord));
        console.info("[RouterOS] response", { command: words[0], kind, attributeNames: Object.keys(attributes) });
        if (kind === "!trap") {
          const message = String(attributes.message || "RouterOS menolak perintah API.");
          if (/invalid user|wrong password|not authorized|authentication/i.test(message)) {
            trapError = new RouterApiError("RouterOS menolak username/password atau hak akses akun API.", "AUTH_REJECTED");
          } else {
            trapError = new RouterApiError(
              `RouterOS menolak perintah: ${message}`,
              words[0] === "/login" ? "AUTH_REJECTED" : "COMMAND_REJECTED",
            );
          }
        }
        if (kind === "!fatal") {
          throw new RouterApiError(String(attributes.message || "RouterOS menutup koneksi API."), "CONNECTION_FATAL");
        }
        if (kind === "!re") replies.push(attributes);
        if (kind === "!done" || kind === "!empty") {
          if (trapError) throw trapError;
          return { replies, attributes };
        }
        if (kind === "!trap") {
          pendingRead = this.read();
          continue;
        }
        if (kind !== "!re") {
          throw new RouterApiError(
            `Respons RouterOS API tidak dikenal${kind ? ` (${kind})` : ""}.`,
            "INVALID_RESPONSE",
          );
        }
        pendingRead = this.read();
      }
    } catch (error) {
      const code = error.code || "ROUTER_API_ERROR";
      if (code === "NO_API_RESPONSE" || code === "INVALID_FRAME" || code === "INVALID_RESPONSE" || code === "CONNECTION_CLOSED") {
        console.warn("[RouterOS] request failed", { command: words[0], code });
      }
      if (error.code === "NO_API_RESPONSE") {
        this.fail(error);
        this.socket.destroy();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  close() {
    this.socket.destroy();
  }
}

export async function loginRouterOS(connection, username, password) {
  console.info("[RouterOS] login stage", { stage: "initial-authentication" });
  let first;
  try {
    first = await connection.request([
      "/login",
      `=name=${username}`,
      `=password=${password}`,
    ], 3500);
  } catch (error) {
    console.warn("[RouterOS] login failed", { stage: "initial-authentication", code: error.code || "ROUTER_API_ERROR" });
    throw error;
  }
  const challenge = first.attributes.ret;
  if (!challenge) {
    console.info("[RouterOS] login succeeded", { stage: "initial-authentication" });
    return;
  }

  console.info("[RouterOS] challenge received", { stage: "initial-authentication" });
  console.info("[RouterOS] login stage", { stage: "challenge-response" });
  const response = challengeResponse(password, challenge);
  let second;
  try {
    second = await connection.request([
      "/login",
      `=name=${username}`,
      `=response=${response}`,
    ], 10000);
  } catch (error) {
    console.warn("[RouterOS] login failed", { stage: "challenge-response", code: error.code || "ROUTER_API_ERROR" });
    throw error;
  }
  if (second.attributes.ret) {
    console.warn("[RouterOS] login failed", { stage: "challenge-response", code: "AUTH_CHALLENGE_ERROR" });
    throw new RouterApiError("RouterOS mengirim challenge autentikasi berulang yang tidak dikenal.", "AUTH_CHALLENGE_ERROR");
  }
  console.info("[RouterOS] login succeeded", { stage: "challenge-response" });
}
