"use strict";

var config = require('../config').config.db,
	connection;

if ( config.type !== 'mysql' ) {
	console.log('Please set your config type to "mysql" first and then execute this script again!');
	process.exit(1);
}

connection =require('mysql').createConnection({
	host: config.auth.host,
	user: config.auth.user,
	password: config.auth.pass
});

connection.connect(function(err) {
	if (err) {
		throw err;
	}

	connection.query('CREATE DATABASE IF NOT EXISTS `' + config.database +'`');
	connection.query('CREATE TABLE IF NOT EXISTS `' + config.database +'`.`pulls` ( `id` INT NOT NULL AUTO_INCREMENT, `number` INT NOT NULL , `repo` VARCHAR( 128 ) NOT NULL, `created_at` VARCHAR( 20 ) NOT NULL , `updated_at`  VARCHAR( 20 ) NOT NULL , `head` VARCHAR( 40 ) NOT NULL , `files` LONGTEXT NOT NULL , PRIMARY KEY (  `id` ) ) ENGINE = INNODB;');
	connection.query('CREATE TABLE IF NOT EXISTS `' + config.database +'`.`jobs` ( `id` VARCHAR( 255 ) NOT NULL , `pull_number` INT NOT NULL , `status` VARCHAR( 20 ) NOT NULL , `head` VARCHAR( 40 ) NOT NULL , PRIMARY KEY (  `id` ) , INDEX (  `pull_number` ), INDEX ( `status` ) ) ENGINE = INNODB;');

	connection.end();
});
