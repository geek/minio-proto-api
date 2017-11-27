'use strict';

const Hapi = require('hapi');
const HapiPino = require('hapi-pino');
const Inert = require('inert');
const Sso = require('minio-proto-auth');
const Allowed = require('./.allowed');
const Api = require('./');

async function main () {
  const server = Hapi.server({ port: process.env.PORT || 80 });

  await server.register([
    Inert,
    {
      plugin: Sso,
      options: {
        cookie: {
          password: process.env.COOKIE_PASSWORD,
          isSecure: false,
          isHttpOnly: true,
          ttl: 1000 * 60 * 60       // 1 hour
        },
        sso: {
          isDev: true,
          keyPath: process.env.SDC_KEY_PATH,
          keyId: process.env.SDC_KEY_ID,
          apiBaseUrl: process.env.SDC_URL
        }
      }
    },
    {
      plugin: HapiPino
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

  server.app.mysql.query('DELETE FROM accounts;', (err) => {
    if (err) {
      console.error(err);
      return;
    }

    const values = new Array(Allowed.length).fill('(?)').join(',');
    const sql = `INSERT INTO accounts VALUES ${values};`;
    server.app.mysql.query(sql, Allowed, (err) => {
      if (err) {
        console.error(err);
        return;
      }

      console.log(`server started at http://localhost:${server.info.port}`);
    });
  });
}

main();
