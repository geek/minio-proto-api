'use strict';
const Path = require('path');
const Hapi = require('hapi');
const Lab = require('lab');
const Sso = require('minio-proto-auth');
const Uuid = require('uuid');
const lab = exports.lab = Lab.script();
const { describe, it, before, after } = lab;
const { expect } = require('code');
const Api = require('../');
const authAccount = {
  id: 'b89d9dd3-62ce-4f6f-eb0d-f78e57d515d9',
  login: 'barbar',
  email: 'barbar@example.com',
  companyName: 'Example Inc',
  firstName: 'BarBar',
  lastName: 'Jinks',
  phone: '123-456-7890',
  updated: '2015-12-21T11:48:54.884Z',
  created: '2015-12-21T11:48:54.884Z'
};
let authServer = null;


async function createServer (options) {
  const server = Hapi.server();

  options = Object.assign({
    db: {
      user: 'test-user',
      password: 'test-pass',
      database: 'test-db'
    }
  }, options);

  await server.register([
    {
      plugin: Sso,
      options: {
        cookie: {
          password: 'cookiepasscookiepasscookiepass12',
          isSecure: false,
          isHttpOnly: true,
          ttl: 1000 * 60 * 60 // 1 hour
        },
        sso: {
          isDev: true,
          keyPath: Path.join(__dirname, 'key-fixture'),
          keyId: '/peterpluck/keys/3f:45:ac:88:92:cc:dd:ee:ff:de:ad:be:ef:12:34:56',
          apiBaseUrl: `http://localhost:${authServer.info.port}`
        }
      }
    },
    { plugin: Api, options }
  ]);

  server.auth.default('sso');

  return server;
}


function createAuthServer () {
  const server = Hapi.server();

  server.route({
    method: 'GET',
    path: '/my',
    handler: function (request, h) {
      return authAccount;
    }
  });

  return server;
}


describe('Minio API', () => {
  before(async () => {
    authServer = createAuthServer();
    await authServer.start();
  });

  after(async () => {
    await authServer.stop();
    authServer = null;
  });

  it('registers the API plugin', async () => {
    const server = await createServer();
    const plugin = server.registrations['minio-proto-api'];

    expect(plugin).to.be.an.object();
  });

  it('creates a new instance', async () => {
    const server = await createServer();
    const payload = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678"],
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

    authAccount.id = Uuid.v4();
    const res = await server.inject({ method: 'POST', url: '/graphql', payload });
    const data = JSON.parse(res.payload).data.createBridge;

    expect(data.bridgeId).to.be.a.string();
    expect(data.bridgeId.length).to.equal(36);
    expect(data.instanceId).to.equal(['1234', '5678']);
    expect(data.accountId).to.equal(authAccount.id);
    expect(data.username).to.equal('jjohnson');
    expect(data.namespace).to.equal('abc123');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });

  it('rejects the wrong number of instance IDs', async () => {
    const server = await createServer();
    const payload = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678", "9999"],
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
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678"],
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
    authAccount.id = Uuid.v4();
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
    expect(data.accountId).to.equal(authAccount.id);
    expect(data.username).to.equal('jjohnson');
    expect(data.namespace).to.equal('abc123');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });

  it('lists all bridges for user', async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678"],
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
    authAccount.id = Uuid.v4();
    let create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId1 = JSON.parse(create.payload).data.createBridge.bridgeId;
    create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId2 = JSON.parse(create.payload).data.createBridge.bridgeId;
    const query = { query: `
      query {
        listBridgesByAccount {
          bridgeId
        }
      }`
    };
    const res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    const data = JSON.parse(res.payload).data.listBridgesByAccount;

    expect(data).to.be.an.array();
    expect(data.length).to.equal(2);
    expect(data.some((bridge) => { return bridge.bridgeId === bridgeId1; })).to.equal(true);
    expect(data.some((bridge) => { return bridge.bridgeId === bridgeId2; })).to.equal(true);
  });

  it('deletes bridges', async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(bridge: {
          instanceId: ["1234", "5678"],
          username: "ppluck",
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
    authAccount.id = Uuid.v4();
    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId = JSON.parse(create.payload).data.createBridge.bridgeId;
    const query = { query: `
      mutation {
        deleteBridge(bridgeId: "${bridgeId}")
      }`
    };
    let res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    expect(JSON.parse(res.payload).data.deleteBridge).to.equal(true);
    res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    expect(JSON.parse(res.payload).data.deleteBridge).to.equal(false);
  });
});
