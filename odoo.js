'use strict';
/* 
  Copier / coller de https://www.npmjs.com/package/odoo
  Ajouté par Coquelicoop : 
    - gestion d'un timeout. Une requête en échec pouvait prendre plusieurs minutes avant de retourner une erreur
    - gestion de https. Outre le protocol lui-même, le Cookie sid ayant un format différent a été adapté.
  Suivre les rares lignes marquées "Coquelicoop" en commentaires pour y retrouver les rares modifications.
*/

var assert = require('assert');
var jayson = require('jayson');
var http = null;

var Odoo = function (config) {
  config = config || {}; 
  this.https = config.https || false; // Ajouté par coquelicoop
  this.host = config.host;
  this.port = config.port || (this.https ? 443 : 80);
  this.database = config.database;
  this.username = config.username;
  this.password = config.password;
  this.timeout = config.timeout || 5000; // Ajouté par coquelicoop
  http = this.https ? require('https') : require('http'); // Ajouté par coquelicoop
};

// Connect
Odoo.prototype.connect = function (cb) {
  var params = {
    db: this.database,
    login: this.username,
    password: this.password
  };

  var json = JSON.stringify({ params: params });

  var options = {
    host: this.host,
    port: this.port,
    timeout: this.timeout, // Ajouté par coquelicoop
    path: '/web/session/authenticate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': json.length
    }
  };

  var self = this;

  var req = http.request(options, function (res) {
    var response = '';

    res.setEncoding('utf8');

    res.on('data', function (chunk) {
      response += chunk;
    });

    res.on('end', function () {
      response = JSON.parse(response);

      if (response.error) {
        return cb(response.error, null);
      }

      self.uid = response.result.uid;
      var cks = res.headers['set-cookie'];

      // Ajouté par coquelicoop
      self.sid = '';
      for (var i = 0, ck = null; ck = cks[i]; i++) {
        if (ck.startsWith('session_id'))
          self.sid = ck.split(';')[0];
      }

      self.session_id = response.result.session_id;
      self.context = response.result.user_context;

      return cb(null, response.result);
    });
  });
  
  req.on('error', function (err) { // Ajouté par coquelicoop
    cb(err)
  });

  req.write(json);
}

// Search records
Odoo.prototype.search = function (model, params, callback) {
  // assert(params.ids, "Must provide a list of IDs.");
  // assert(params.domain, "Must provide a search domain.");

  this._request('/web/dataset/call_kw', {
    kwargs: {
      context: this.context
    },
    model: model,
    method: 'search',
    args: [
      params.domain,
    ],
  }, callback);
};

// Search & Read records
// https://www.odoo.com/documentation/8.0/api_integration.html#search-and-read
// https://www.odoo.com/documentation/8.0/reference/orm.html#openerp.models.Model.search
// https://www.odoo.com/documentation/8.0/reference/orm.html#openerp.models.Model.read
Odoo.prototype.search_read = function (model, params, callback) {
  assert(params.domain, "'domain' parameter required. Must provide a search domain.");
  assert(params.limit, "'limit' parameter required. Must specify max. number of results to return.");

  this._request('/web/dataset/call_kw', {
    model: model,
    method: 'search_read',
    args: [],
    kwargs: {
      context: this.context,
      domain: params.domain,
      offset: params.offset,
      limit: params.limit,
      order: params.order,
      fields: params.fields,
    },
  }, callback);
};

// Get record
// https://www.odoo.com/documentation/8.0/api_integration.html#read-records
// https://www.odoo.com/documentation/8.0/reference/orm.html#openerp.models.Model.read
Odoo.prototype.get = function (model, params, callback) {
  assert(params.ids, "Must provide a list of IDs.");

  this._request('/web/dataset/call_kw', {
    model: model,
    method: 'read',
    args: [
      params.ids,
    ],
    kwargs: {
      fields: params.fields,
    },
  }, callback);
}; //get


// Browse records by ID
// Not a direct implementation of Odoo RPC 'browse' but rather a workaround based on 'search_read'
// https://www.odoo.com/documentation/8.0/reference/orm.html#openerp.models.Model.browse
Odoo.prototype.browse_by_id = function(model, params, callback) {
  params.domain = [['id', '>', '0' ]];  // assumes all records IDs are > 0
  this.search_read(model, params, callback);
}; //browse


// Create record
Odoo.prototype.create = function (model, params, callback) {
  this._request('/web/dataset/call_kw', {
    kwargs: {
      context: this.context
    },
    model: model,
    method: 'create',
    args: [params]
  }, callback);
};

// Update record
Odoo.prototype.update = function (model, id, params, callback) {
  if (id) {
    this._request('/web/dataset/call_kw', {
      kwargs: {
        context: this.context
      },
      model: model,
      method: 'write',
      args: [[id], params]
    }, callback);
  }
};

// Delete record
Odoo.prototype.delete = function (model, id, callback) {
  this._request('/web/dataset/call_kw', {
    kwargs: {
      context: this.context
    },
    model: model,
    method: 'unlink',
    args: [[id]]
  }, callback);
};


// Generic RPC wrapper
// DOES NOT AUTO-INCLUDE context
Odoo.prototype.rpc_call = function (endpoint, params, callback) {
  assert(params.model);
  // assert(params.method);
  // assert(params.args);
  // assert(params.kwargs);
  // assert(params.kwargs.context);

  this._request(endpoint, params, callback);
}; //generic


// Private functions
Odoo.prototype._request = function (path, params, callback) {
  params = params || {};

  var options = {
    host: this.host,
    port: this.port,
    path: path || '/',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Cookie': this.sid + ';'
    }
  };

  var client = this.https ? jayson.client.https(options) : jayson.client.http(options); // Ajouté par coquelicoop

  client.request('call', params, function (e, err, res) {
    if (e || err) {
      return callback(e || err, null);
    }

    return callback(null, res);
  });
};

module.exports = Odoo;
