'use strict';

const Assert = require('assert');
const Boom = require('boom');
const Bounce = require('bounce');
const Crypto = require('crypto');
const Fs = require('fs');
const QueryString = require('querystring');
const Wreck = require('wreck');


// required for signing requests
const keyId = process.env.SDC_KEY_ID;
const key = Fs.readFileSync(process.env.SDC_KEY_PATH);


module.exports = class CloudApi {
  constructor ({ token, url }) {
    Assert(token || (process.env.NODE_ENV === 'development') || (process.env.NODE_ENV === 'test'), 'token is required for production');

    this._token = token;
    this._wreck = Wreck.defaults({
      headers: this._authHeaders(),
      baseUrl: `${url}/my`,
      json: true
    });
  }

  getSshKey (name) {
    return this._fetch({ path: `/keys/${name}` });
  }

  createSshKey (name, key) {
    return this._fetch({ path: '/keys', method: 'post', payload: { name, key } });
  }

  deleteSshKey (name) {
    return this._fetch({ path: `/keys/${name}`, method: 'delete' });
  }

  _authHeaders () {
    const now = new Date().toUTCString();
    const signer = Crypto.createSign('sha256');
    signer.update(now);
    const signature = signer.sign(key, 'base64');

    const headers = {
      'Content-Type': 'application/json',
      Date: now,
      Authorization: `Signature keyId="${keyId}",algorithm="rsa-sha256" ${signature}`
    };

    if (this._token) {
      headers['X-Auth-Token'] = this._token;
    }

    return headers;
  }

  async _fetch (options = {}) {
    let path = options.path || '/';
    if (options.query) {
      path += `?${QueryString.stringify(options.query)}`;
    }

    const method = options.method && options.method.toLowerCase() || 'get';

    try {
      const { payload } = await this._wreck[method](path, { payload: options.payload });
      return payload;
    } catch (ex) {
      Bounce.rethrow(ex, 'system');
      if (ex.data && ex.data.payload && ex.data.payload.message) {
        throw new Boom(ex.data.payload.message, ex.output.payload);
      }

      throw ex;
    }
  }
};
