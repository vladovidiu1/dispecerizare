import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createOllama } from "../server/ollama.js";
const skillId = "11111111-1111-4111-8111-111111111111";
async function fixture(fn) {
  let result = { skillId, confidence: 0.95, reason: "Cerere despre factură" },
    captured;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags")
      return res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
    let text = "";
    for await (const chunk of req) text += chunk;
    captured = JSON.parse(text);
    res.end(
      JSON.stringify({
        message: {
          content: typeof result === "string" ? result : JSON.stringify(result),
        },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    await fn(
      createOllama({ url: "http://127.0.0.1:" + server.address().port }),
      () => captured,
      (r) => {
        result = r;
      },
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const input = {
  skills: [{ id: skillId, name: "Facturare" }],
  examples: [{ skillId, subject: "Exemplu", body: "Factura mea" }],
  subject: "Factură",
  body: "Detalii factură",
};
test("local Ollama adapter sends dynamic skills, examples and JSON schema without streaming/thinking", async () =>
  fixture(async (ai, get) => {
    assert.equal((await ai.status()).installed, true);
    const r = await ai.classify(input);
    assert.equal(r.skillId, skillId);
    assert.equal(r.model, "qwen3:8b");
    const payload = get();
    assert.equal(payload.think, false);
    assert.equal(payload.stream, false);
    assert.equal(payload.options.num_ctx, 4096);
    assert.deepEqual(JSON.parse(payload.messages[1].content), {
      skills: input.skills,
      examples: input.examples,
      email: { subject: input.subject, body: input.body },
    });
    assert.ok(
      payload.format.properties.skillId.anyOf[0].enum.includes(skillId),
    );
  }));
test("invented tags, malformed JSON, null tags and invalid confidence never become assignments", async () =>
  fixture(async (ai, get, set) => {
    for (const data of [
      {
        skillId: "22222222-2222-4222-8222-222222222222",
        confidence: 1,
        reason: "x",
      },
      "not json",
      { skillId: null, confidence: 0.1, reason: "Ambiguu" },
      { skillId, confidence: 5, reason: "x" },
    ]) {
      set(data);
      await assert.rejects(
        () => ai.classify(input),
        (e) => ["OLLAMA_INVALID_OUTPUT", "OLLAMA_UNCERTAIN"].includes(e.code),
      );
    }
  }));
test("refuses nonlocal inference endpoints and does not silently truncate a large configuration", async () => {
  assert.throws(() => createOllama({ url: "https://external.example" }));
  assert.throws(() => createOllama({ url: "http://127.0.0.1/path" }));
  assert.throws(() => createOllama({ url: "http://localhost?redirect=1" }));
  await fixture(async (ai) => {
    await assert.rejects(
      () => ai.classify({ ...input, body: "x".repeat(12000) }),
      { code: "OLLAMA_CONTEXT_TOO_LARGE" },
    );
  });
});

test("ITL guidance accepts only quoted evidence from the supplied local document chunks", async () =>
  fixture(async (ai, get, set) => {
    const sources = [
        {
          id: skillId,
          title: "Resetare parola",
          documentId: skillId,
          page: 2,
          body: "Verifica identitatea utilizatorului. Deschide ecranul de resetare parola.",
        },
      ],
      input = { subject: "Resetare parola", body: "Nu am acces", sources };
    set({
      steps: [
        {
          text: "Verifică identitatea.",
          sourceId: skillId,
          quote: "Verifica identitatea utilizatorului.",
        },
      ],
    });
    const result = await ai.guide(input);
    assert.equal(result.steps.length, 1);
    assert.equal(get().think, false);
    assert.equal(get().options.num_ctx, 4096);
    for (const steps of [
      [
        {
          text: "Inventat",
          sourceId: skillId,
          quote: "Acest citat nu apare in document",
        },
      ],
      [
        {
          text: "Inventat",
          sourceId: "other-id",
          quote: "Verifica identitatea utilizatorului.",
        },
      ],
    ]) {
      set({ steps });
      await assert.rejects(
        () => ai.guide(input),
        (e) => e.code === "OLLAMA_INVALID_OUTPUT",
      );
    }
    set({ steps: [] });
    assert.deepEqual((await ai.guide(input)).steps, []);
  }));
