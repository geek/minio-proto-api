'use strict';

const Path = require('path');
const Barrier = require('cb-barrier');
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

  const barrier = new Barrier();
  server.app.mysql.query('DELETE FROM accounts;', (err) => {
    if (err) {
      return barrier.pass(err);
    }

    const values = new Array(1).fill('(?)').join(',');
    const sql = `INSERT INTO accounts VALUES ${values};`;
    server.app.mysql.query(sql, authAccount.id, (err) => {
      if (err) {
        return barrier.pass(err);
      }

      barrier.pass(server);
    });
  });

  return barrier;
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

  it('creates a new bridge', async () => {
    const server = await createServer();
    const payload = { query: `
      mutation {
        createBridge(
          username: "jjohnson",
          namespace: "abc123",
          directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        ) {
          bridgeId, containerId, accountId, username, namespace, directoryMap
        }
      }`
    };

    const res = await server.inject({ method: 'POST', url: '/graphql', payload });
    const data = JSON.parse(res.payload).data.createBridge;

    expect(data.bridgeId).to.be.a.string();
    expect(data.bridgeId.length).to.equal(36);
    expect(data.accountId).to.equal(authAccount.id);
    expect(data.username).to.equal('jjohnson');
    expect(data.namespace).to.equal('abc123');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });

  it('retrieves an existing bridge', async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(
          username: "jjohnson",
          namespace: "abc123",
          directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        ) {
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
          bridgeId, containerId, accountId, username, namespace, directoryMap
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
    expect(data.containerId).to.exist();
    expect(data.accountId).to.equal(authAccount.id);
    expect(data.username).to.equal('jjohnson');
    expect(data.namespace).to.equal('abc123');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });

  it('lists all bridges for user', async () => {
    const server = await createServer();
    const barrier = new Barrier();
    server.app.mysql.query('DELETE FROM bridges;', (err) => {
      if (err) {
        return barrier.pass(err);
      }

      barrier.pass();
    });

    await barrier;

    const mutation = { query: `
      mutation {
        createBridge(
          username: "jjohnson",
          namespace: "abc123",
          directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        ) {
          bridgeId
        }
      }`
    };

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
        createBridge(
          username: "ppluck",
          namespace: "abc123",
          directoryMap: "*:/stor/*",
          sshKey: "12:c3:de:ad:be:ef",
          accessKey: "foobar",
          secretKey: "bazquux"
        ) {
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
