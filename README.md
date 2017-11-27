# minio-proto-api

## Development Usage

Create a local `.env.js` file with the following variables set:

```js
process.env.SDC_URL = 'https://us-sw-1.api.joyentcloud.com';
process.env.SDC_KEY_ID = '';
process.env.SDC_KEY_PATH = '';
process.env.COOKIE_PASSWORD = '';
process.env.PORT = 8080;
process.env.DOCKER_CERT_PATH = '';
process.env.DOCKER_HOST = 'tcp://us-sw-1.docker.joyent.com:2376';
process.env.DOCKER_TLS_VERIFY = '1';
```

Create a local `.allowed.js` file with the list of allowed account Ids:
```js
module.exports = [
  'YOUR ACCOUNT ID'
];
```

```sh
$ npm run dev
```

```sh
$ open http://localhost:8080/graphiql
```

Create a bridge:
```
mutation {
  createBridge(
      username: "myname", namespace: "abc123", directoryMap: "*:/stor/*",
      sshKey: "12:c3:de:ad:be:ef", accessKey: "foobar", secretKey: "bazquux")
  {
    bridgeId
  }
}

```
