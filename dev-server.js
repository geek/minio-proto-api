'use strict';

const Hapi = require('hapi');
const HapiPino = require('hapi-pino');
const Api = require('./');

async function main () {
  const server = Hapi.server({ port: process.env.PORT || 80 });

  await server.register([
    {
      plugin: HapiPino,
      options: {
        logEvents: ['request-error', 'error', 'graqhql-error']
      }
    },
    {
      plugin: Api,
      options: { db: { database: 'minio' } }
    }
  ]);

  await server.start();
  // eslint-disable-next-line no-console
  console.log(`server started at http://localhost:${server.info.port}`);
}

main();
