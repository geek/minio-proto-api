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

  it('creates a new instance', async () => {
    const server = createServer();
    const payload = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678"],
          accountId: "888",
          username: "jjohnson",
          namespace: "abc123",
          directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        }) {
          bridgeId, instanceId, accountId, username, namespace, directoryMap
        }
      }`
    };

    const res = await server.inject({ method: 'POST', url: '/graphql', payload });
    const data = JSON.parse(res.payload).data.createBridge;

    expect(data.bridgeId).to.be.a.string();
    expect(data.bridgeId.length).to.equal(36);
    expect(data.instanceId).to.equal(['1234', '5678']);
    expect(data.accountId).to.equal('888');
    expect(data.username).to.equal('jjohnson');
    expect(data.namespace).to.equal('abc123');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });

  it('rejects the wrong number of instance IDs', async () => {
    const server = createServer();
    const payload = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678", "9999"],
          accountId: "888",
          username: "jjohnson",
          namespace: "abc123",
          directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        }) {
          instanceId
        }
      }`
    };

    const res = await server.inject({ method: 'POST', url: '/graphql', payload });
    const result = JSON.parse(res.payload);

    expect(result.data.createBridge).to.equal(null);
    expect(result.errors[0].message).to.equal('two instance IDs are required');
  });

  it('retrieves an existing bridge', async () => {
    const server = createServer();
    const mutation = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678"],
          accountId: "888",
          username: "jjohnson",
          namespace: "abc123",
          directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        }) {
          bridgeId
        }
      }`
    };
    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId = JSON.parse(create.payload).data.createBridge.bridgeId;
    const query = { query: `
      query {
        bridge(bridgeId: "${bridgeId}") {
          bridgeId, instanceId, accountId, username, namespace, directoryMap
        }
      }`
    };
    const res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    const data = JSON.parse(res.payload).data.bridge;

    expect(data.bridgeId).to.equal(bridgeId);
    expect(data.instanceId).to.equal(['1234', '5678']);
    expect(data.accountId).to.equal('888');
    expect(data.username).to.equal('jjohnson');
    expect(data.namespace).to.equal('abc123');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });
});
