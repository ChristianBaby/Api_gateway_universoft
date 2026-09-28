import test from 'node:test';
import assert from 'node:assert/strict';

import { getServices } from '../src/config/services.js';

test('los servicios GIS no colisionan con Scanner ni Tramitador', () => {
  const services = getServices();

  assert.equal(services.SCANNER_CONTRATOS.baseUrl, 'http://localhost:4012');
  assert.equal(services.TRAMITADOR.baseUrl, 'http://localhost:4013');
  assert.equal(services.GEOMETRIAS.baseUrl, 'http://localhost:4016');
  assert.equal(services.GEOPROCESOS.baseUrl, 'http://localhost:4017');

  const urls = [
    services.SCANNER_CONTRATOS.baseUrl,
    services.TRAMITADOR.baseUrl,
    services.GEOMETRIAS.baseUrl,
    services.GEOPROCESOS.baseUrl,
  ];
  assert.equal(new Set(urls).size, urls.length);
});
