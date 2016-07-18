/**
 * The GitHub integration plugin
 * @module GitHub
 */
"use strict";

var http = require('http'),
	async = require('async'),
	range_check = require('range_check'),
	emitter = require('events').EventEmitter,
	events = new emitter(),
	GitHubApi = require('github');

// We only want to accept local requests and GitHub requests. See the Service Hooks
// page of any repo you have admin access to to see the list of GitHub public IPs.
var allowed_ips = [ '127.0.0.1' ],
	allowed_events = [ 'pull_request', 'issue_comment' ];

/**
 * @class GitHub
 * @param config {Object} The plugins configs
 * @param mergeatron {Mergeatron} An instance of the main Mergeatron object
 * @param events {Object} An EventDispatcher instance used when handling webhook events
 * @constructor
 */
var GitHub = function(config, mergeatron, events) {
	config.api = config.api || {};

	this.config = config;
	this.mergeatron = mergeatron;
	this.events = events;
	this.api = new GitHubApi({
		version: '3.0.0',
		host: config.api.host || null,
		port: config.api.port || null
	});

	this.api.authenticate({
		type: 'basic',
		username: config.auth.user,
		password: config.auth.pass
	});
};

/**
 * Sets up the GitHub plugin. Depending on the selecting configs either a webserver
 * will be setup for receiving webhook events or asynchronous polling will be setup.
 *
 * @method setup
 */
GitHub.prototype.setup = function() {
	if (this.config.method === 'hooks') {
		this.setupServer();
		this.checkRepos();
	} else {
		var self = this;
		async.parallel({
			'github': function() {
				var run_github = function() {
					self.checkRepos();
					setTimeout(run_github, self.config.frequency);
				};

				run_github();
			}
		});
	}
};

/**
 * If webhooks are configured this will setup a server on the specified IP that
 * will listen for events from GitHub. Only the configured events will be listened
 * for and only the configured IPs will be listened to.
 *
 * @method setupServer
 */
GitHub.prototype.setupServer = function() {
	this.mergeatron.log.debug('Setting up local server on port ' + this.config.port);

	var self = this;
	http.createServer(function(request, response) {
		if (allowed_ips.indexOf(request.connection.remoteAddress) == -1) {
			self.mergeatron.log.debug('Received post from blocked ip: ' + request.connection.remoteAddress);
			response.writeHead(403, { 'Content-Type': 'text/plain' });
			response.end();
			return;
		}

		if (typeof request.headers['x-github-event'] == 'undefined' || allowed_events.indexOf(request.headers['x-github-event']) == -1) {
			self.mergeatron.log.debug('Received post for unsupported event: ' + request.headers['x-github-event']);
			response.writeHead(501, { 'Content-Type': 'text/plain' });
			response.write('Unsupported event type');
			response.end();
			return;
		}

		var data = '';
		request.on('data', function(chunk) {
			data += chunk.toString();
		});

		request.on('end', function() {
			self.mergeatron.log.debug('Received post for event: ' + request.headers['x-github-event']);
			self.events.emit(request.headers['x-github-event'], JSON.parse(data));
		});

		response.writeHead(200, { "Content-Type": "text/plain" });
		response.end();
	}).listen(this.config.port);
};

/**
 * Iterates over the configured list of repositories and uses the GitHub API to check each one for pull requests.
 *
 * @method checkRepos
 */
GitHub.prototype.checkRepos = function() {
	this.mergeatron.log.debug('Polling github for new and updated Pull Requests');

	var self = this;
	this.config.repos.forEach(function(repo) {
		self.api.pullRequests.getAll({ 'user': self.config.user, 'repo': repo, 'state': 'open' }, function(error, resp) {
			if (error) {
				self.mergeatron.log.error(error);
				return;
			}

			for (var i in resp) {
				var pull = resp[i],
					number = pull.number;

				if (!number || number == 'undefined') {
					continue;
				}

				// Currently the GitHub API doesn't provide the same information for polling as
				// it does when requesting a single, specific, pull request. So we have to
				self.api.pullRequests.get({ 'user': self.config.user, 'repo': repo, 'number': number }, function(error, pull) {
					if (error) {
						self.mergeatron.log.error(error);
						return;
					}

					self.events.emit('pull_request', pull);
				});
			}
		});
	});
};

/**
 * Uses the GitHub API to pull the list of files and diffs for the provided pull request.
 * These will be parsed and saved on the pull object to be saved to the database later.
 *
 * @method checkFiles
 * @param pull {Object}
 */
GitHub.prototype.checkFiles = function(pull) {
	this.mergeatron.log.debug('Checking files for pull request', { pull_number: pull.number, repo: pull.repo });

	var self = this;
	this.api.pullRequests.getFiles({ 'user': this.config.user, 'repo': pull.repo, 'number': pull.number }, function(err, files) {
		if (err) {
			self.mergeatron.log.error(err);
			return;
		}

		pull.files = [];
		files.forEach(function(file) {
			if (!file.filename || file.filename == 'undefined') {
				return;
			}

			var start = null,
				length = null,
				deletions = [],
				modified_length,
				offset = 0,
				line_number = 0;

			file.ranges = [];
			file.reported = [];
			file.sha = file.blob_url.match(/blob\/([^\/]+)/)[1];

			// The GitHub API doesn't return the actual patch when it's exceedingly large
			if (file.patch) {
				file.patch.split('\n').forEach(function(line) {
					var matches = line.match(/^@@ -\d+,\d+ \+(\d+),(\d+) @@/);
					if (matches) {
						if (start == null && length == null) {
							start = parseInt(matches[1], 10);
							length = parseInt(matches[2], 10);
							line_number = start;
						} else {
							// The one is for the line in the diff block containing the line numbers
							modified_length = 1 + length + deletions.length;
							file.ranges.push([ start, start + length, modified_length, offset, deletions ]);

							deletions = [];
							start = parseInt(matches[1], 10);
							length = parseInt(matches[2], 10);
							offset += modified_length;
							line_number = start;
						}
					} else if (line.indexOf('-') === 0) {
						deletions.push(line_number);
					} else {
						line_number += 1;
					}
				});
			}

			if (start != null && length != null) {
				file.ranges.push([ start, start + length, 1 + length + deletions.length, offset, deletions ]);
			}

			pull.files.push(file);
		});

		if (pull.files.length > 0) {
			self.mergeatron.emit('pull.found', pull);
		} else {
			self.mergeatron.log.info('Skipping pull request, no modified files found', { pull_number: pull.number, repo: pull.repo });
		}
	});
};

/**
 * Starts the process of processing a pull request. Will retrieve the pull request from the database or insert a new
 * record for it if needed. The pull request is then checked to see if it should be processed or not and dispatches
 * the appropriate event if so.
 *
 * @method processPull
 * @param pull {Object}
 */
GitHub.prototype.processPull = function(pull) {
	var self = this;
	this.mergeatron.db.findPull(pull.number, function(error, item) {
		if (!pull || !pull.head || !pull.head.repo) {
			return;
		}
		var new_pull = false,
			ssh_url = pull.head.repo.ssh_url,
			branch = pull.head.label.split(':')[1];

		if (!item) {
			new_pull = true;
			self.mergeatron.db.insertPull(pull, function(err) {
				if (err) {
					self.mergeatron.log.error(err);
					process.exit(1);
				}
			});
			pull.jobs = [];
		} else {
			// Before updating the list of files in db we need to make sure the set of reported lines is saved
			item.files.forEach(function(file) {
				pull.files.forEach(function(pull_file, i) {
					if (pull_file.filename == file.filename) {
						pull.files[i].reported = file.reported;
					}
				});
			});
			self.mergeatron.db.updatePull(pull.number, { files: pull.files });
			pull.jobs = item.jobs;
		}

		if (new_pull || pull.head.sha != item.head) {
			self.mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
			return;
		}

		if (typeof pull.skip_comments != 'undefined' && pull.skip_comments) {
			self.mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
			return;
		}

		self.api.issues.getComments({
			user: self.config.user,
			repo: pull.repo,
			number: pull.number,
			per_page: 100
		}, function(error, resp) {
			for (var i in resp) {
				if (i == 'meta') {
					continue
				}

				var comment = resp[i];
				if (
					self.config.retry_whitelist
					&& self.config.retry_whitelist.indexOf(comment.user.login) == -1
					&& comment.user.login != pull.head.user.login
				) {
					continue;
				}

				if (comment.created_at > item.updated_at && comment.body.indexOf('@' + self.config.auth.user + ' retest') != -1) {
					self.mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
					return;
				}
			}
		});
	});
};

/**
 * Uses the GitHub API to create a Merge Status for a pull request.
 *
 * @method createStatus
 * @param sha {String}
 * @param user {String}
 * @param repo {String}
 * @param state {String}
 * @param build_url {String}
 * @param description {String}
 */
GitHub.prototype.createStatus = function(sha, user, repo, state, build_url, description) {
	this.api.repos.create({
		user: user,
		repo: repo,
		sha: sha,
		state: state,
		target_url: build_url,
		description: description
	});
};

/**
 * Uses the GitHub API to create an inline comment on the diff of a pull request.
 *
 * @method createComment
 * @param pull {Object}
 * @param sha {String}
 * @param file {String}
 * @param position {String}
 * @param comment {String}
 */
GitHub.prototype.createComment = function(pull, sha, file, position, comment) {
	if (!file && !position && !comment) {
		this.api.issues.createComment({
			user: this.config.user,
			repo: pull.repo,
			number: pull.number,
			body: sha
		});
	} else {
		this.api.pullRequests.createComment({
			user: this.config.user,
			repo: pull.repo,
			number: pull.number,
			body: comment,
			commit_id: sha,
			path: file,
			position: position
		});
	}
};

/**
 * Receives a pull request at the very beginning of the process, either from a webhook event or from the REST API,
 * and checks to make sure we care about it.
 *
 * @method handlePullRequest
 * @param pull {Object}
 */
GitHub.prototype.handlePullRequest = function(pull) {
	// Check if this came through a webhooks setup
	if (pull.action !== undefined) {
		if (pull.action != 'synchronize' && pull.action != 'opened') {
			this.mergeatron.log.debug('Not building pull request, action not supported', { pull_number: pull.number, action: pull.action });
			return;
		}

		pull = pull.pull_request;
	}

	// During testing there were cases where the mergeable flag was null when using webhooks.
	// In that case we want to allow the build to be attempted. We only want to prevent it when
	// the mergeable flag is explicitly set to false.
	if (pull.mergeable !== undefined && pull.mergeable === false) {
		this.mergeatron.log.debug('Not building pull request, not in mergeable state', { pull_number: pull.number, mergeable: pull.mergeable });
		return;
	}

	if (pull.body && pull.body.indexOf('@' + this.config.user + ' ignore') != -1) {
		this.mergeatron.log.debug('Not building pull request, flagged to be ignored', { pull_number: pull.number });
		return;
	}

	pull.repo = pull.base.repo.name;
	if (this.config.skip_file_listing) {
		pull.files = [];
		this.mergeatron.emit('pull.found', pull);
	} else {
		this.checkFiles(pull);
	}
};

/**
 * Receives an issue comment from a webhook event and checks to see if we need to worry about it. If so the
 * associated pull request will be loaded via the REST API and sent on its way for processing.
 *
 * @method handleIssueComment
 * @param comment {Object}
 */
GitHub.prototype.handleIssueComment = function(comment) {
	// This event will pick up comments on issues and pull requests but we only care about pull requests
	if (comment.issue.pull_request.html_url == null) {
		return;
	}

	if (comment.comment.body.indexOf('@' + this.config.auth.user + ' retest') == -1) {
		this.mergeatron.log.debug('Received retest request for pull', { pull_number: comment.issue.number, repo: comment.repository.name });

		var self = this;
		this.api.pullRequests.get({ 'user': this.config.user, 'repo': comment.repository.name, 'number': comment.issue.number }, function(error, pull) {
			if (error) {
				self.mergeatron.log.error(error);
				return;
			}

			pull.skip_comments = true;
			self.events.emit('pull_request', pull);
		});
	}
};

exports.init = function(config, mergeatron) {
	var github = new GitHub(config, mergeatron, events);
	github.setup();

	mergeatron.on('pull.validated', function(pull) {
		github.processPull(pull);
	});

	mergeatron.on('build.started', function(job, pull, build_url) {
		github.createStatus(job.head, config.user, pull.repo, 'pending', build_url, 'Mergeatron Build Started');
	});

	mergeatron.on('build.failed', function(job, pull, build_url) {
		github.createStatus(job.head, config.user, pull.repo, 'failure', build_url, 'Mergeatron Build Failed');
	});

	mergeatron.on('build.succeeded', function(job, pull, build_url) {
		github.createStatus(job.head, config.user, pull.repo, 'success', build_url, 'Mergeatron Build Succeeded');
	});

	mergeatron.on('pull.inline_status', function(pull, sha, file, position, comment) {
		github.createComment(pull, sha, file, position, comment) ;
	});

	mergeatron.on('pull.status', function(pull, comment) {
		github.createComment(pull, comment);
	});

	events.on('pull_request', function(pull) {
		github.handlePullRequest(pull);
	});

	events.on('issue_comment', function(data) {
		github.handleIssueComment(data);
	});
};
