"use strict";

var config = require('./config').config.db;
exports.init = function() {
	if (config.type === 'mongo') {
		return require('mongojs').connect(config.database, config.tables);
	}
};