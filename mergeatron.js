"use strict";

var config = require('./config').config,
	db =  require('./db').init(),
	fs = require('fs'),
	events = require('events'),
	winston = require('winston');

/**
 * The main Mergeatron class that. This class contains a reference to the selected
 * database.
 *
 * @class Mergeatron
 * @module Mergeatron
 * @param db {Object} Instance of the database accesor
 * @constructor
 */
var Mergeatron = function(db, config) {
	this.db = db;
    this.log = {
      error: function(err){
        var stack = new Error().stack
        console.log( stack )
        console.log( err )
      },
      info: function(info){
        console.log(info)
      },
      debug: function(debug, params){
        params = params || {};
        console.log(debug + ' :: ' + JSON.stringify(params));
      }
    };
};

Mergeatron.prototype = new events.EventEmitter();
var mergeatron = new Mergeatron(db, config);


config.plugin_dirs.forEach(function(dir) {
	fs.readdir(dir, function(err, files) {
		if (err) {
			mergeatron.log.error(err);
			process.exit(1);
		}

		for (var i = 0, l = files.length; i < l; i++) {
			var filename = dir + files[i],
				pluginName = files[i].split('.', 2)[0],
				conf = { enabled: true };

			if (!filename.match(/\.js$/)) {
				continue;
			}

			mergeatron.log.info('Loading plugin: ' + pluginName);

			if (config.plugins && config.plugins[pluginName]) {
				conf = config.plugins[pluginName];
			}

			if (conf.enabled === undefined || conf.enabled) {
				require(filename).init(conf, mergeatron);
			} else {
				mergeatron.log.info('Not loading disabled plugin ' + pluginName);
			}
		}
	});
});
