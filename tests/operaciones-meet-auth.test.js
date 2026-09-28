import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// Config SOLO del proceso de prueba; no lee/escribe .env ni inicia login/server.
const secret = 'test-only-jwt-secret-operations-not-real';
process.env.JWT_SECRET = secret;
const { authenticateJWT } = await import('../src/middlewares/auth.middleware.js');

async function check(token, centralUser = { id: 'trusted-actor', rol: 'operaciones' }) {
    let next = false; let status; let body;
    const req = { method: 'GET', path: '/connection', headers: token ? { authorization: `Bearer ${token}` } : {},
        centralSessionToken: token, centralSessionUser: centralUser };
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    const log = console.log; const error = console.error; const fetchOriginal = globalThis.fetch;
    try {
        console.log = () => {}; console.error = () => {};
        globalThis.fetch = async () => assert.fail('No login/red real: sesión central ya verificada por boundary fake');
        await authenticateJWT(req, res, () => { next = true; });
    } finally { console.log = log; console.error = error; globalThis.fetch = fetchOriginal; }
    return { next, status, body, user: req.user };
}

test('JWT real válido conserva identidad de sesión central en vez de claims stale', async () => {
    const token = jwt.sign({ id: 'stale-actor', rol: 'admin' }, secret, { expiresIn: 60 });
    const result = await check(token); assert.equal(result.next, true);
    assert.deepEqual(result.user, { id: 'trusted-actor', rol: 'operaciones' });
});

test('JWT inválido/expirado o ausente no pasa aunque exista cache de sesión; nunca hace red', async () => {
    for (const token of [undefined, 'malformed', jwt.sign({ id: 'actor' }, 'wrong-secret'), jwt.sign({ id: 'actor' }, secret, { expiresIn: -1 })]) {
        const result = await check(token); assert.equal(result.next, false); assert.equal(result.status, 401);
    }
});

test('token no-access y algoritmo incorrecto no pasan frontera real JWT', async () => {
    for (const token of [jwt.sign({ id: 'actor', token_use: 'refresh' }, secret), jwt.sign({ id: 'actor' }, secret, { algorithm: 'HS384' })]) {
        const result = await check(token); assert.equal(result.next, false); assert.equal(result.status, 401);
    }
});
