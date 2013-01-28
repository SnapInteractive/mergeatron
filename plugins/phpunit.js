/**
 * The PHPUnit integration plugin
 * @module PHPUnit
 */
"use strict";

var request = require('request'),
	xml2js = require('xml2js');

/**
 * @class PhpUnit
 * @param config {Object} The plugins configs
 * @param mergeatron {Mergeatron} An instance of the main Mergeatron object
 * @constructor
 */
var PhpUnit = function(config, mergeatron) {
	this.config = config;
	this.mergeatron = mergeatron;
};

/**
 * Processes a PHPUnit generated junit.xml
 *
 * @method process
 * @param build {String}
 * @param pull {Object}
 * @param artifact_url {String}
 */
PhpUnit.prototype.process = function(build, pull, artifact_url) {
	var self = this;

	request({ url: artifact_url }, function(err, response) {
		if (err) {
			self.mergeatron.log.error(err);
			return;
		}

		var parser = new xml2js.Parser();
		parser.parseString(response.body, function (err, result) {
			if (err) {
				self.mergeatron.log.error('Failed to parse PHPUnit artifact', err);
				return;
			}

			if (!result) {
				return;
			}

			var error_count = 0,
				errors = [],
				message = '',
				truncate = false;

			for (var i in result.testsuites) {
				var item = result.testsuites[i];

				// First check if there were any errors in the test suite, if not there's nothing to do.
				if (item[0]['$'].errors == 0) {
					continue;
				}

				// We don't want to leave too big of a comment, so lets only check for individual
				// errors if there aren't too many
				error_count += parseInt(item[0]['$'].errors) + parseInt(item[0]['$'].failures);

				if (errors.length < self.config.failure_limit) {
					errors.push(item[0].testsuite[0].testcase[0].failure[0]._);
				} else {
					truncate = true;
				}
			}

			if (error_count > 0) {
				message = "Build failed due to test failures. __" + error_count + "__ test failure(s) found.\n";
			}

			if (errors.length > 0) {
				errors.forEach(function(error, i) {
					// The error message has a blank line between the message and the file, need to strip that out
					error = error.replace(/\n\n/gi, "\n");

					message += '>' + error + "\n";
				});
			}

			if (truncate) {
				message += "There were too many failures to display detailed information on all of them. View build details for full list of failures\n";
			}

			if (message) {
				message += "\n\n[Click Here For More Information](" + build.url + ")";
				self.mergeatron.emit('pull.status', pull, message);
			}
		});
	});
};

exports.init = function(config, mergeatron) {
	var phpunit = new PhpUnit(config, mergeatron);

	mergeatron.on('build.artifact_found', function (build, pull, artifact) {
		if (artifact.relativePath == config.artifact) {
			phpunit.process(build, pull, artifact.url);
		}
	});
};