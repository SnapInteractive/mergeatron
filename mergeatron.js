"use strict";

var config = require('./config').config,
	db =  require('./db').init(),
	fs = require('fs'),
	events = require('events');

/**
 * The main Mergeatron class that. This class contains a reference to the selected
 * database.
 *
 * @class Mergeatron
 * @module Mergeatron
 * @param db {Object} Instance of the database accesor
 * @constructor
 */
var Mergeatron = function(db) {
	this.db = db;
};

Mergeatron.prototype = new events.EventEmitter();
var mergeatron = new Mergeatron(db);

config.plugin_dirs.forEach(function(dir) {
	fs.readdir(dir, function(err, files) {
		if (err) {
			console.log(err);
			return;
		}

		for (var i = 0, l = files.length; i < l; i++) {
			var filename = dir + files[i],
				pluginName = files[i].split('.', 2)[0],
				conf = { enabled: true };

			if (!filename.match(/\.js$/)) {
				break;
			}

			console.log('Loading plugin: ' + pluginName);

			if (config.plugins && config.plugins[pluginName]) {
				conf = config.plugins[pluginName];
			}

			if (conf.enabled === undefined || conf.enabled) {
				require(filename).init(conf, mergeatron);
			} else {
				console.log('Not loading disabled plugin ' + pluginName);
			}
		}
	});
});