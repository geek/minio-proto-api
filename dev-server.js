'use strict';

const Fs = require('fs');
const Hapi = require('hapi');
// const HapiPino = require('hapi-pino');
const Inert = require('inert');
const Sso = require('minio-proto-auth');
const Api = require('./');

async function main () {
  const server = Hapi.server({
    port: process.env.PORT || 80,
    routes: { cors: true }
  });

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
          keyId: '/' + process.env.SDC_ACCOUNT + '/keys/' + process.env.SDC_KEY_ID,
          apiBaseUrl: process.env.SDC_URL,
          url: 'https://sso.joyent.com/login',
          permissions: { 'cloudapi': ['/my/*'] }
        }
      }
    },
    // HapiPino,
    {
      plugin: Api,
      options: {
        admins: Fs.readFileSync('./.allowed', 'utf8'),
        authStrategy: 'sso',
        graphiAuthStrategy: 'sso',
        db: {
          user: 'test-user',
          password: 'test-pass',
          database: 'dev-db'
        },
        cloudflare: {
          zoneId: process.env.CF_ZONEID,
          email: process.env.CF_EMAIL,
          key: process.env.CF_KEY,
          arecordParent: process.env.ARECORD_PARENT
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
