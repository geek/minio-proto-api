'use strict';
const Hapi = require('hapi');
const Lab = require('lab');
const lab = exports.lab = Lab.script();
const { describe, it } = lab;
const { expect } = require('code');
const Api = require('../');


function createServer (options) {
  const server = Hapi.server();

  options = Object.assign({
    db: {
      user: 'test-user',
      password: 'test-pass',
      database: 'test-db'
    }
  }, options);
  server.register({ plugin: Api, options });
  return server;
}


describe('Minio API', () => {
  it('registers the API plugin', () => {
    const server = createServer();
    const plugin = server.registrations['minio-proto-api'];

    expect(plugin).to.be.an.object();
  });

  it('can create a new instance', async () => {
    const server = createServer();
    const payload = { query: `
      mutation {
        createBridge(bridge: {
            instanceId: "999",
              accountId: "888",
              username: "jjohnson",
              namespace: "abc123",
              directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        }) {
          instanceId, accountId
        }
      }`
    };

    const res = await server.inject({ method: 'POST', url: '/graphql', payload });
    const body = JSON.parse(res.payload);
    expect(body.data.createBridge.instanceId).to.equal('999');
  });
});
