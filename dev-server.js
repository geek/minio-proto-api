'use strict';

const Hapi = require('hapi');
const HapiPino = require('hapi-pino');
const Inert = require('inert');
const Api = require('./');

async function main () {
  const server = Hapi.server({ port: process.env.PORT || 80 });

  await server.register([
    Inert,
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

  await server.start();
  // eslint-disable-next-line no-console
  console.log(`server started at http://localhost:${server.info.port}`);
}

main();
