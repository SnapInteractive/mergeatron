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
						console.log(err);
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
		options = {
			url: url.format({
				protocol: this.config.protocol,
				host: this.config.host,
				pathname: '/job/' + project.name + '/buildWithParameters',
				query: {
					token: project.token,
					cause: 'Testing Pull Request: ' + number,
					REPOSITORY_URL: ssh_url,
					BRANCH_NAME: branch,
					JOB: job_id,
					PULL: number,
					BASE_BRANCH_NAME: pull.base.ref
				}
			}),
			method: 'GET'
		};

	if (this.config.user && this.config.pass) {
		options.headers = {
			authorization: 'Basic ' + (new Buffer(this.config.user + ":" + this.config.pass, 'ascii').toString('base64'))
		};
	}

	var self = this;
	request(options, function(error) {
		if (error) {
			console.log(error);
			return;
		}

		self.mergeatron.db.updatePull(number, { head: sha, updated_at: updated_at});
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
		this.mergeatron.emit('pull.validated', pull);
		return;
	}

	for (var x in pull.files) {
		if (!pull.files[x].filename || typeof pull.files[x].filename != 'string') {
			continue;
		}

		for (var y in project.rules) {
			if (pull.files[x].filename.match(project.rules[y])) {
				this.mergeatron.emit('pull.validated', pull);
				return;
			}
		}
	}
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
		project = this.findProjectByRepo(pull.repo),
		options = {
			url: url.format({
				protocol: this.config.protocol,
				host: this.config.host,
				pathname: '/job/' + project.name + '/api/json',
				query: {
					tree: 'builds[number,url,actions[parameters[name,value]],building,result]'
				}
			}),
			json: true
		};

	request(options, function(error, response) {
		if (error) {
			console.log('could not connect to jenkins, there seems to be a connectivity issue!');
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

					if (job.status != 'finished') {
						if (build.result == 'FAILURE') {
							self.mergeatron.db.updateJobStatus(job.id, 'finished');
							self.mergeatron.emit('build.failed', job, pull, build.url + 'console');

							self.processArtifacts(build, pull);
						} else if (build.result == 'SUCCESS') {
							self.mergeatron.db.updateJobStatus(job.id, 'finished');
							self.mergeatron.emit('build.succeeded', job, pull, build.url);

							self.processArtifacts(build, pull);
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
 * Downloads the artifacts for a build and dispatches an event for each one. This lets other plugins parse and process
 * results from the build however they like.
 *
 * @method processArtifacts
 * @param build {String}
 * @param pull {Object}
 */
Jenkins.prototype.processArtifacts = function(build, pull) {
	var project = this.findProjectByRepo(pull.repo),
		options = {
		url: url.format({
			protocol: this.config.protocol,
			host: this.config.host,
			pathname: '/job/' + project.name + '/' + build.number + '/api/json',
			query: {
				tree: 'artifacts[fileName,relativePath]'
			}
		}),
		json: true
	};

	var self = this;
	request(options, function(err, response) {
		if (err) {
			console.log(err);
			return;
		}

		var artifacts = response.body.artifacts;
		for (var i in artifacts) {
			artifacts[i].url = build.url + 'artifact/' + artifacts[i].relativePath;
			self.mergeatron.emit('build.artifact_found', build, pull, artifacts[i]);
		}
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
};
