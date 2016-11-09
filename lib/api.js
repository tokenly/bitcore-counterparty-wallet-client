'use strict';

var _       = require('lodash');
var $       = require('preconditions').singleton();
var util    = require('util');
var events  = require('events');
var url     = require('url');
var log     = require('./log');
var Package = require('../package.json');
var Errors  = require('./errors');

var request;
if (process && !process.browser) {
  request = require('request');
} else {
  request = require('browser-request');
}

var API_VERSION = 'v1';
var BASE_URL    = 'http://localhost:3232/counterparty/api';

/**
 * @desc ClientAPI constructor.
 *
 * @param {Object} opts
 * @constructor
 */
function API(opts) {
  opts = opts || {};

  this.verbose = !!opts.verbose;
  this.request = opts.request || request;
  this.baseUrl = opts.baseUrl || BASE_URL;
  var parsedUrl = url.parse(this.baseUrl);
  this.basePath = parsedUrl.path;
  this.baseHost = parsedUrl.protocol + '//' + parsedUrl.host;
  this.timeout = opts.timeout || 50000;

  if (this.verbose) {
    log.setLevel('debug');
  } else {
    log.setLevel('info');
  }
};
util.inherits(API, events.EventEmitter);

API.prototype.initialize = function(opts, cb) {
  return cb();
};

API.prototype.dispose = function(cb) {
  var self = this;
  return cb();
};


/**
 * Parse errors
 * @private
 * @static
 * @memberof Client.API
 * @param {Object} body
 */
API._parseError = function(body) {
  if (!body) return;

  if (_.isString(body)) {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {
        error: body
      };
    }
  }
  var ret;
  console.log('body: ', body);
  if (body.code) {
    if (Errors[body.code]) {
      ret = new Errors[body.code];
    } else {
      ret = new Error(body.code);
    }
  } else {
    console.log('body.message', body.message);
    ret = new Error(body.message || body);
  }
  log.error(ret);
  return ret;
};


API.prototype._getHeaders = function(method, url, args) {
  var headers = {
    'x-client-version': 'bwc-' + Package.version,
  };

  if (this.credentials) {
    var reqSignature;
    var key = args._requestPrivKey || this.credentials.requestPrivKey;
    if (key) {
      delete args['_requestPrivKey'];
      reqSignature = API._signRequest(method, url, args, key);
    }
    headers['x-identity'] = this.credentials.copayerId;
    headers['x-signature'] = reqSignature;
  }
  return headers;
}



/**
 * Do an HTTP request
 * @private
 *
 * @param {Object} method
 * @param {String} url
 * @param {Object} args
 * @param {Callback} cb
 */
API.prototype._doRequest = function(method, url, args, cb) {
  var absUrl = this.baseUrl + '/'+API_VERSION + url;
  var newArgs = {
    // relUrl: only for testing with `supertest`
    relUrl: this.basePath + url,
    headers: this._getHeaders(method, url, args),
    method: method,
    url: absUrl,
    body: args,
    json: true,
    withCredentials: false,
    timeout: this.timeout,
  };

  log.debug('Request Args', util.inspect(args, {
    depth: 10
  }));

  this.request(newArgs, function(err, res, body) {
    log.debug(util.inspect(body, {
      depth: 10
    }));
    if (!res) {
      return cb(new Errors.CONNECTION_ERROR);
    }

    console.log('res.statusCode:', res.statusCode);
    if (res.statusCode !== 200) {
      if (res.statusCode === 404)
        return cb(new Errors.NOT_FOUND);

      if (!res.statusCode)
        return cb(new Errors.CONNECTION_ERROR);

      log.error('HTTP Error:' + res.statusCode);

      if (!body)
        return cb(new Error(res.statusCode));

      return cb(API._parseError(body));
    }

    if (body === '{"error":"read ECONNRESET"}')
      return cb(new Errors.ECONNRESET_ERROR(JSON.parse(body)));

    if (body.errors != null && body.message != null) {
      return cb(new Error(body.message));
    }

    return cb(null, body, res.header);
  });
};

/**
 * Do a POST request
 * @private
 *
 * @param {String} url
 * @param {Object} args
 * @param {Callback} cb
 */
API.prototype._doPostRequest = function(url, args, cb) {
  return this._doRequest('post', url, args, cb);
};

API.prototype._doPutRequest = function(url, args, cb) {
  return this._doRequest('put', url, args, cb);
};

/**
 * Do a GET request
 * @private
 *
 * @param {String} url
 * @param {Callback} cb
 */
API.prototype._doGetRequest = function(url, cb) {
  url += url.indexOf('?') > 0 ? '&' : '?';
  url += 'r=' + _.random(10000, 99999);
  return this._doRequest('get', url, {}, cb);
};

/**
 * Do a DELETE request
 * @private
 *
 * @param {String} url
 * @param {Callback} cb
 */
API.prototype._doDeleteRequest = function(url, cb) {
  return this._doRequest('delete', url, {}, cb);
};



/**
 * Get service version
 *
 * @param {Callback} cb
 */
API.prototype.getVersion = function(cb) {
  this._doGetRequest('/version', cb);
};


/**
 * Get address balances
 *
 * @param {Callback} cb
 */
API.prototype.getBalances = function(address, cb) {
  this._doGetRequest('/balances/'+address, cb);
};

/**
 * Get transactions by address transaction ids
 *
 * @param {Callback} cb
 */
API.prototype.getTransactions = function(address, txids, cb) {
  if (txids == null || txids.length == 0) {
    return cb(null, []);
  }

  var args = {
    address: address,
    txids:   txids
  }

  this._doPostRequest('/transactions', args, cb);
};

/**
 * Get asset info by asset name
 *
 * @param {Callback} cb
 */
API.prototype.getBvamInfo = function(assets, cb) {
  if (assets == null || assets.length == 0) {
    return cb('Asset names were invalid');
  }
  var args = {
    assets: assets
  }

  this._doPostRequest('/bvam/info', args, cb);
};

/**
 * Upload new data to the BVAM provider
 *
 * @param {Callback} cb
 */
API.prototype.addBvamData = function(bvamData, cb) {
  console.log('=BVAM= addBvamData');
  if (bvamData == null) {
    return cb('bvam data is required');
  }
  var args = {
    bvam: bvamData
  }

  this._doPostRequest('/bvam', args, cb);
};







// /**
//  * Broadcast raw transaction
//  *
//  * @param {Object} opts
//  * @param {String} opts.network
//  * @param {String} opts.rawTx
//  * @param {Callback} cb
//  * @return {Callback} cb - Return error or txid
//  */
// API.prototype.broadcastRawTx = function(opts, cb) {
//   $.checkState(this.credentials);
//   $.checkArgument(cb);

//   var self = this;

//   opts = opts || {};

//   var url = '/v1/broadcast_raw/';
//   self._doPostRequest(url, opts, function(err, txid) {
//     if (err) return cb(err);
//     return cb(null, txid);
//   });
// };










module.exports = API;
