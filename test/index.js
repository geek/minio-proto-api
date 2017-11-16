'use strict';
const Hapi = require('hapi');
const Lab = require('lab');
const lab = exports.lab = Lab.script();
const { describe, it } = lab;
const { expect } = require('code');
const Api = require('../');


async function createServer (options) {
  const server = Hapi.server();

  options = Object.assign({ db: { database: 'minio' } }, options);
  await server.register({ plugin: Api, options });
  return server;
}


describe('Minio API', () => {
  it('registers the API plugin', async () => {
    const server = await createServer();
    const plugin = server.registrations['minio-proto-api'];

    expect(plugin).to.be.an.object();
  });
});
