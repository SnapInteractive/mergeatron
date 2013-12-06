/**
 * The Jenkins integration plugin
 * @module Jenkins
 */
"use strict";

var request = require('request'),
	url = require('url'),
	uuid = require('node-uuid'),
	async = require('async');

/**
 * @class Jenkins
 * @param config {Object} The plugins configs
 * @param mergeatron {Mergeatron} An instance of the main Mergeatron object
 * @constructor
 */
var Jenkins = function(config, mergeatron) {
	this.config = config;
	this.mergeatron = mergeatron;
};

/**
 * Searches a pull requests jobs to find the unfinished one, if one exists.
 *
 * @method findUnfinishedJob
 * @param pull {Object}
 * @returns {Object}
 */
Jenkins.prototype.findUnfinishedJob = function(pull) {
	for (var x in pull.jobs) {
		if (pull.jobs[x].status != 'finished') {
			return pull.jobs[x];
		}
	}
};

/**
 * Searches through the configs to find the appropriate project for the provided repo.
 *
 * @method findProjectByRepo
 * @param repo {String}
 * @returns {Object}
 */
Jenkins.prototype.findProjectByRepo = function(repo) {
	var found = null;
	this.config.projects.forEach(function(project) {
		if (repo == project.repo) {
			found = project;
		}
	});

	return found;
};

/**
 * Sets up an asynchronous job that polls the Jenkins API to look for jobs that are finished.
 *
 * @method setup
 */
Jenkins.prototype.setup = function() {
	var self = this;
	async.parallel({
		'jenkins': function() {
			var run_jenkins = function() {
				self.mergeatron.db.findPullsByJobStatus(['new', 'started'], function(err, pull) {
					if (err) {
						self.mergeatron.log.error(err);
						process.exit(1);
					}

					if (!pull) {
						return;
					}
					self.checkJob(pull);
				});

				setTimeout(run_jenkins, self.config.frequency);
			};

			run_jenkins();
		}
	});
};

/**
 * Uses the Jenkins REST API to trigger a new build for the provided pull request.
 *
 * @method buildPull
 * @param pull {Object}
 * @param number {String}
 * @param sha {String}
 * @param ssh_url {String}
 * @param branch {String}
 * @param updated_at {String}
 * @todo Do we need to pass all these parameters, is just passing pull enough?
 */
Jenkins.prototype.buildPull = function(pull, number, sha, ssh_url, branch, updated_at) {
	var project = this.findProjectByRepo(pull.repo),
		job_id = uuid.v1(),
		self = this;

	this.mergeatron.log.info('Starting build for pull', { pull_number: pull.number, project: project.name });

	this.triggerBuild(project.name, {
		token: project.token,
		cause: 'Testing Pull Request: ' + number,
		REPOSITORY_URL: ssh_url,
		BRANCH_NAME: branch,
		JOB: job_id,
		PULL: number,
		BASE_BRANCH_NAME: pull.base.ref,
		SHA: sha
	}, function(error) {
		if (error) {
			self.mergeatron.log.error(error);
			return;
		}

		self.mergeatron.db.updatePull(number, pull.repo, { head: sha, updated_at: updated_at});
		self.mergeatron.db.insertJob(pull, {
			id: job_id,
			status: 'new',
			head: sha
		});
	});
};

/**
 * Called when a new pull is being checked to see if it should be processed. This method will iterate
 * over the configured projects to find the right one and check that ones rules to see if a build should
 * be triggered for it based on the files that were modified.
 *
 * @method pullFound
 * @param pull {Object}
 */
Jenkins.prototype.pullFound = function(pull) {
	var project = this.findProjectByRepo(pull.repo);

	if (!project) {
		return;
	}

	if (!project.rules) {
		this.mergeatron.log.debug('Validating pull with no rules', { pull: pull.number, project: project.name });
		this.mergeatron.emit('pull.validated', pull);
		return;
	}

	for (var x in pull.files) {
		if (!pull.files[x].filename || typeof pull.files[x].filename != 'string') {
			continue;
		}

		for (var y in project.rules) {
			if (pull.files[x].filename.match(project.rules[y])) {
				this.mergeatron.log.debug('Validating pull with rules', { pull: pull.number, project: project.name });
				this.mergeatron.emit('pull.validated', pull);
				return;
			}
		}
	}

	this.mergeatron.log.debug('Invalidating pull with rules', { pull: pull.number, project: project.name });
};

/**
 * Uses the Jenkins REST API to check if the provided pull request has any jobs that recently finished. If so
 * their status in the database is updated and events are triggered so other plugins can re-act to the completion
 * of the job.
 *
 * @method checkJob
 * @param pull {Object}
 */
Jenkins.prototype.checkJob = function(pull) {
	var self = this,
		job = this.findUnfinishedJob(pull),
		project = this.findProjectByRepo(pull.repo);

	this.checkBuild(project.name, function(error, response) {
		if (error) {
			self.mergeatron.log.error('Could not connect to jenkins, there seems to be a connectivity issue!');
			return;
		}

		response.body.builds.forEach(function(build) {
			if (typeof build.actions == 'undefined' || typeof build.actions[0].parameters == 'undefined' || !build.actions[0].parameters) {
				return;
			}

			build.actions[0].parameters.forEach(function(param) {
				if (param.name == 'JOB' && param.value == job.id) {
					if (job.status == 'new') {
						self.mergeatron.db.updateJobStatus(job.id, 'started');
						self.mergeatron.emit('build.started', job, pull, build.url);
					}

					if (job.status != 'finished' && !build.building) {
						if (build.result == 'FAILURE') {
							self.mergeatron.db.updateJobStatus(job.id, 'finished');
							self.mergeatron.emit('build.failed', job, pull, build.url + 'console');

							self.processArtifacts(project.name, build, pull);
						} else if (build.result == 'SUCCESS') {
							self.mergeatron.db.updateJobStatus(job.id, 'finished');
							self.mergeatron.emit('build.succeeded', job, pull, build.url);

							self.processArtifacts(project.name, build, pull);
						} else if (build.result == 'ABORTED') {
							self.mergeatron.db.updateJobStatus(job.id, 'finished');
							self.mergeatron.emit('build.aborted', job, pull, build.url);
						}
					}
				}
			});
		});
	});
};

/**
 * Makes a GET request to the Jenkins API to start a build
 *
 * @method triggerBuild
 * @param job_name {String}
 * @param url_options {Options}
 * @param callback {Function}
 */
Jenkins.prototype.triggerBuild = function(job_name, url_options, callback) {
	var options = {
		url: url.format({
			protocol: this.config.protocol,
			host: this.config.host,
			pathname: '/job/' + job_name + '/buildWithParameters',
			query: url_options
		}),
		method: 'GET'
	};

	if (this.config.user && this.config.pass) {
		options.headers = {
			authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
		};
	}

	request(options, callback);
};

/**
 * Checks the Jenkins API for the status of a job
 *
 * @method checkBuild
 * @param job_name {String}
 * @param callback {Function}
 */
Jenkins.prototype.checkBuild = function(job_name, callback) {
	var self = this,
		options = {
			url: url.format({
				protocol: this.config.protocol,
				host: this.config.host,
				pathname: '/job/' + job_name + '/api/json',
				query: {
					tree: 'builds[number,url,actions[parameters[name,value]],building,result]'
				}
			}),
			json: true
		};

	if (this.config.user && this.config.pass) {
		options.headers = {
			authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
		};
	}

	request(options, function(error, response) {
		callback(error, response, self.mergeatron);
	});
};

/**
 * Downloads the artifact list for a build and dispatches an event for each one. This lets other
 * plugins parse and process results from the build however they like.
 *
 * @method processArtifacts
 * @param job_name {String}
 * @param build {String}
 * @param pull {Object}
 */
Jenkins.prototype.processArtifacts = function(job_name, build, pull) {
	var options = {
		url: url.format({
			protocol: this.config.protocol,
			host: this.config.host,
			pathname: '/job/' + job_name + '/' + build.number + '/api/json',
			query: {
				tree: 'artifacts[fileName,relativePath]'
			}
		}),
		json: true
	};

	if (this.config.user && this.config.pass) {
		options.headers = {
			authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
		};
	}

	var self = this;
	request(options, function(err, response) {
		if (err) {
			self.mergeatron.log.error(err);
			return;
		}

		self.mergeatron.log.debug('Retrieved artifacts for build', { build: build.number, project: job_name });

		response.body.artifacts.forEach(function(artifact) {
			artifact.url = self.config.protocol + '://' + self.config.host + '/job/' + job_name + '/' + build.number + '/artifact/' + artifact.relativePath;

			self.mergeatron.log.debug('Found artifact for build', { build: build.number, url: artifact.url });
			self.mergeatron.emit('build.artifact_found', build, pull, artifact);
		});
	});
};

/**
 * Downloads a specific artifact and dispatches an event with its contents.
 *
 * @method downloadArtifact
 * @param build {String}
 * @param pull {Object}
 * @param url {String}
 */
Jenkins.prototype.downloadArtifact = function(build, pull, artifact) {
	var self = this,
		options = { url: artifact.url };

	if (this.config.user && this.config.pass) {
		options.headers = {
			authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
		};
	}

	request(options, function(err, response) {
		if (err) {
			self.mergeatron.log.error(err);
			return;
		}

		self.mergeatron.emit('build.artifact_downloaded', build, pull, artifact.relativePath, response.body);
	});
};

exports.init = function(config, mergeatron) {
	var jenkins = new Jenkins(config, mergeatron);
	jenkins.setup();

	mergeatron.on('pull.processed', function(pull, pull_number, sha, ssh_url, branch, updated_at) {
		jenkins.buildPull(pull, pull_number, sha, ssh_url, branch, updated_at);
	});

	mergeatron.on('pull.found', function(pull) {
		jenkins.pullFound(pull);
	});

	mergeatron.on('build.download_artifact', function(build, pull, artifact) {
		jenkins.downloadArtifact(build, pull, artifact);
	});

	mergeatron.on('build.trigger', function(job_name, url_options) {
		jenkins.triggerBuild(job_name, url_options, function(error) {
			if (error) {
				mergeatron.log.info('Received error from Jenkins when triggering build', { job_name: job_name, url_options: url_options });
			}
		});
	});

	mergeatron.on('build.check', function(job_name, callback) {
		jenkins.checkBuild(job_name, callback);
	});

	mergeatron.on('process_artifacts', function(job_name, build, pull) {
		jenkins.processArtifacts(job_name, build, pull);
	});
};
