var config = require('./config').config,
	mongo = require('mongojs').connect(config.mongo, ['pulls', 'jobs']),
	fs = require('fs'),
	events = require('events');

Array.prototype.randomValue = function() {
	return this[Math.floor(Math.random() * this.length)];
};

var Mergeatron = function(mongo) {
	this.mongo = mongo;
};

Mergeatron.prototype = new events.EventEmitter;
mergeatron = new Mergeatron(mongo);

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

			console.log('Loading plugin: ' + pluginName);

			if (config.plugins && config.plugins[pluginName]) {
				conf = config.plugins[pluginName];
			}

			if (conf.enabled == undefined || conf.enabled) {
				require(filename).init(conf, mergeatron);
			} else {
				console.log('Not loading disabled plugin ' + pluginName);
			}
		}
	});
});