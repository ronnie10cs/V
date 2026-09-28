import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiError, generate, speak } from '../../web/gemini.js';

const reply = (status, body) => async (url, init) => {
  reply.last = { url, init: { ...init, body: JSON.parse(init.body) } };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};

test('generate envía el formato REST de Gemini', async () => {
  const fetchImpl = reply(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'hola' }] } }] });
  const out = await generate({
    apiKey: 'k', system: 'sis', contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
    tools: [{ name: 'calcular', description: 'd', parameters: { type: 'object', properties: {} } }], fetchImpl,
  });
  assert.deepEqual(out, { role: 'model', parts: [{ text: 'hola' }] });
  const { url, init } = reply.last;
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(init.headers['x-goog-api-key'], 'k');
  assert.deepEqual(init.body.systemInstruction, { parts: [{ text: 'sis' }] });
  assert.equal(init.body.tools[0].functionDeclarations[0].parametersJsonSchema.type, 'object');
});

test('errores comprensibles', async () => {
  await assert.rejects(generate({ apiKey: 'k', system: '', contents: [], fetchImpl: reply(429, {}) }), /cuota/);
  await assert.rejects(
    generate({ apiKey: 'k', system: '', contents: [], fetchImpl: reply(400, { error: { message: 'API key not valid' } }) }),
    /clave de Gemini no es válida/,
  );
  await assert.rejects(generate({ apiKey: 'k', system: '', contents: [], fetchImpl: async () => { throw new TypeError('x'); } }), GeminiError);
});

test('respuesta bloqueada', async () => {
  const out = await generate({ apiKey: 'k', system: '', contents: [], fetchImpl: reply(200, { promptFeedback: { blockReason: 'SAFETY' } }) });
  assert.match(out.parts[0].text, /SAFETY/);
});

test('speak lee el audio de la Interactions API y añade cabecera WAV si falta', async () => {
  const pcm = Buffer.from([1, 0, 2, 0]).toString('base64');
  const fetchImpl = reply(200, { steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcm }] }] });
  const blob = await speak({ apiKey: 'k', text: 'Hola', voice: 'Charon', fetchImpl });
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 44 + 4);
  assert.equal(reply.last.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.deepEqual(reply.last.init.body.generation_config, { speech_config: [{ voice: 'Charon' }] });
  await assert.rejects(speak({ apiKey: 'k', text: 'x', fetchImpl: reply(200, {}) }), /no devolvió audio/);
});
