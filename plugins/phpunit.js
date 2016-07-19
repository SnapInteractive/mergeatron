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
	this.errors = [];
	this.found_count = 0;
	this.truncate = false;
};

/**
 * Recursively scans a test suite for errors and failures
 *
 * @method scanTestSuite
 * @param testsuite {Object}
 */
PhpUnit.prototype.scanTestsuite = function(testsuite) {
	var self = this,
		error_count = parseInt(testsuite['$'].errors),
		failure_count = parseInt(testsuite['$'].failures);

	// If we've logged enough errors we don't need to keep looking for more
	if (this.truncate) {
		return;
	}

	// First check if there were any errors in the test suite, if not there's nothing to do.
	if (error_count == 0 && failure_count == 0) {
		return;
	}

	// It's possible for a test suite to have more suites under it
	if (testsuite.testsuite) {
		testsuite.testsuite.forEach(function(suite) {
			self.scanTestsuite(suite);
		});

		return;
	}

	testsuite.testcase.forEach(function(testcase) {
		if (typeof testcase.failure != undefined) {
			if (self.errors.length > self.config.failure_limit) {
				self.truncate = true;
				return;
			}

			self.errors.push(testcase.failure[0]._);
		}
	});
};

/**
 * Processes a PHPUnit generated junit.xml
 *
 * @method process
 * @param build {String}
 * @param pull {Object}
 * @param artifact_url {String}
 */
PhpUnit.prototype.process = function(build, pull, artifact) {
	var self = this,
		parser = new xml2js.Parser(),
		message = '';

	this.errors = [];
	this.found_count = 0;
	this.truncate = false;

	parser.parseString(artifact, function (err, result) {
		if (err) {
			self.mergeatron.log.error('Failed to parse PHPUnit artifact', err);
			return;
		}

		if (!result) {
			return;
		}

		if (typeof result.testsuites[0] == undefined) {
			result.testsuites = [ result.testsuites.testsuite ];
		}

		for (var i in result.testsuites) {
			var item = result.testsuites[i],
				error_count = parseInt(item[0]['$'].errors),
				failure_count = parseInt(item[0]['$'].failures);

			// First check if there were any errors in the test suite, if not there's nothing to do.
			if (error_count == 0 && failure_count == 0) {
				continue;
			}

			// We don't want to leave too big of a comment, so lets only check for individual
			// errors if there aren't too many
			self.found_count += error_count + failure_count;

			if (self.found_count < self.config.failure_limit) {
				self.scanTestsuite(item[0]);
			} else {
				self.truncate = true;
			}
		}

		if (self.found_count > 0) {
			message = "Build failed due to test failures. __" + self.found_count + "__ test failure(s) found.\n";
		}

		if (self.errors.length > 0) {
			self.errors.forEach(function(error, i) {
				// The error message has a blank line between the message and the file, need to strip that out
				error = error.replace(/\n\n/gi, "\n");

				message += '>' + error + "\n";
			});
		}

		if (self.truncate) {
			message += "There were too many failures to display detailed information on all of them. View build details for full list of failures\n";
		}

		if (message) {
			message += "\n\n[Click Here For More Information](" + build.url + ")";
			self.mergeatron.emit('pull.status', pull, message);
		}
	});
};

exports.init = function(config, mergeatron) {
	var phpunit = new PhpUnit(config, mergeatron);

	mergeatron.on('build.artifact_found', function (build, pull, artifact) {
		mergeatron.log.debug('PHPUnit checking artifact', { config: config.artifact, path: artifact.relativePath });
		if (artifact.relativePath == config.artifact) {
			mergeatron.emit('build.download_artifact', build, pull, artifact);
		}
	});

	mergeatron.on('build.artifact_downloaded', function(build, pull, name, artifact) {
		if (name == config.artifact) {
			phpunit.process(build, pull, artifact);
		}
	});
};