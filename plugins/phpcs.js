/**
 * The PHP Code Sniffer integration plugin
 * @module PHPCS
 */
"use strict";

var request = require('request');

/**
 * @class PhpCs
 * @param config {Object} The plugins configs
 * @param mergeatron {Mergeatron} An instance of the main Mergeatron object
 * @constructor
 */
var PhpCs = function(config, mergeatron) {
	this.config = config;
	this.mergeatron = mergeatron;
};

/**
 * Processes a PHPCS CSV file. Will determine if any of the entries within the file are for files
 * that were modified as part of the provided pull request and are within the diffs for those files.
 * An event will be dispatched for each violation.
 *
 * @method process
 * @param build {String}
 * @param pull {Object}
 * @param artifact_url {String}
 */
PhpCs.prototype.process = function(build, pull, artifact_url) {
	var self = this;
	request({ url: artifact_url }, function(err, response) {
		if (err) {
			console.log(err);
			return;
		}

		var violations = self.parseCsvFile(response.body);
		pull.files.forEach(function(file) {
			if (file.status != 'modified' && file.status != 'added') {
				return;
			}

			violations.forEach(function(violation) {
				if (violation.file.indexOf(file.filename) == -1) {
					return;
				}

				var line_number = parseInt(violation.line, 10);
				if (file.reported.indexOf(line_number) != -1) {
					return;
				}

				file.ranges.forEach(function(range) {
					if (line_number >= range[0] && line_number <= range[1]) {
						var diff_offset = range[3] + (line_number - range[0]) + 1;
						if (range[4] && range[4].length > 0) {
							range[4].forEach(function(deletion) {
								if (deletion <= line_number) {
									diff_offset += 1;
								}
							});
						}

						file.reported.push(line_number);
						self.mergeatron.emit('pull.inline_status', pull, file.sha, file.filename, diff_offset, violation.message);
						self.mergeatron.db.insertLineStatus(pull, file.filename , line_number);
					}
				});
			});
		});
	});
};

/**
 * Parses a PHPCS CSV file and returns the result as an array of objects.
 *
 * @method parseCsvFile
 * @param data {String}
 * @returns {Array}
 */
PhpCs.prototype.parseCsvFile = function(data) {
	var iteration = 0,
		header = [],
		records = [],
		pattern = /(?:^|,)("(?:[^"]+)*"|[^,]*)/g,
		parts = data.split('\n');

	for (var x in parts) {
		var line = parts[x];

		if (!line) {
			continue;
		}

		if (iteration++ === 0) {
			header = line.split(pattern);
		} else {
			records.push(buildRecord(line));
		}
	}

	function buildRecord(str){
		var record = {},
			fields = str.split(pattern);

		for (var y in fields) {
			if (header[y]) {
				record[header[y].toLowerCase()] = fields[y].replace(/"/g, '');
			}
		}

		return record;
	}

	return records;
};

exports.init = function(config, mergeatron) {
	var phpcs = new PhpCs(config, mergeatron);

	mergeatron.on('build.artifact_found', function (build, pull, artifact) {
		if (artifact.relativePath == config.artifact) {
			phpcs.process(build, pull, artifact.url);
		}
	});
};