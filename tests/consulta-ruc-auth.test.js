import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/routes/consulta.routes.js'), 'utf8');

test('consulta DNI/RUC exige sesión y permite que APIs Perú valide la serie del RUC', () => {
  assert.match(source, /router\.get\('\/api\/consulta\/dni\/:numero', authenticateJWT,/);
  assert.match(source, /router\.get\('\/api\/consulta\/ruc\/:numero', authenticateJWT,/);
  assert.match(source, /if \(!\/\^\\d\{11\}\$\//);
  assert.doesNotMatch(source, /\^\(10\|20\)\\d\{9\}/);
});
