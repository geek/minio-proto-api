'use strict';

const Hapi = require('hapi');
const HapiPino = require('hapi-pino');
const Inert = require('inert');
const Sso = require('minio-proto-auth');
const Api = require('./');

async function main () {
  const server = Hapi.server({ port: process.env.PORT || 80 });

  await server.register([
    Inert,
    {
      plugin: Sso,
      options: {
        sso: {
          isDev: true,
          keyPath: process.env.SDC_KEY_PATH,
          keyId: process.env.SDC_KEY_ID,
          apiBaseUrl: process.env.SDC_URL
        }
      }
    },
    {
      plugin: HapiPino,
      options: {
        logEvents: ['request-error', 'error', 'graqhql-error']
      }
    },
    {
      plugin: Api,
      options: {
        db: {
          user: 'test-user',
          password: 'test-pass',
          database: 'test-db'
        }
      }
    }
  ]);

  server.route([
    {
      method: 'GET',
      path: '/doc/{param*}',
      config: {
        handler: {
          directory: {
            path: './doc',
            redirectToSlash: true,
            index: true
          }
        }
      }
    }
  ]);

  server.auth.default('sso');

  await server.start();
  console.log(`server started at http://localhost:${server.info.port}`);
}

main();
