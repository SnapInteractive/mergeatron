"use strict";

var http = require('http'),
	async = require('async'),
	emitter = require('events').EventEmitter,
	events = new emitter(),
	GitHubApi = require('github'),
	GitHub = new GitHubApi({ version: '3.0.0' });

// We only want to accept local requests and GitHub requests. See the Service Hooks
// page of any repo you have admin access to to see the list of GitHub public IPs.
var allowed_ips = [ '127.0.0.1', '207.97.227.253', '50.57.128.197', '108.171.174.178' ],
	allowed_events = [ 'pull_request', 'issue_comment' ];

exports.init = function(config, mergeatron) {
	GitHub.authenticate({
		type: 'basic',
		username: config.auth.user,
		password: config.auth.pass
	});

	if (config.method === 'hooks') {
		setupServer();
	} else {
		setupPolling();
	}

	mergeatron.on('pull.validated', function(pull) {
		processPull(pull);
	});

	mergeatron.on('build.started', function(job, pull, build_url) {
		createStatus(job.head, 'pending', build_url, 'Testing Pull Request');
	});

	mergeatron.on('build.failed', function(job, pull, build_url) {
		createStatus(job.head, 'failure', build_url, 'Build failed');
	});

	mergeatron.on('build.succeeded', function(job, pull, build_url) {
		createStatus(job.head, 'success', build_url, 'Build succeeded');
	});

	mergeatron.on('pull.inline_status', function(pull, sha, file, position, comment) {
		GitHub.pullRequests.createComment({
			user: config.user,
			repo: config.repo,
			number: pull.number,
			body: comment,
			commit_id: sha,
			path: file,
			position: position
		});
	});

	events.on('pull_request', function(pull) {
		if (pull.action !== undefined && pull.action != 'synchronize' && pull.action != 'opened') {
			return;
		}

		if (pull.body && pull.body.indexOf('@' + config.user + ' ignore') != -1) {
			return;
		}

		if (config.skip_file_listing) {
			pull.files = [];
			mergeatron.emit('pull.found', pull);
		} else {
			checkFiles(pull);
		}
	});

	events.on('issue_comment', function(data) {
		// This event will pick up comments on issues and pull requests but we only care about pull requests
		if (data.issue.pull_request.html_url == null) {
			return;
		}

		if (data.comment.body.indexOf('@' + config.auth.user + ' retest') == -1) {
			GitHub.pullRequests.get({ 'user': config.user, 'repo': config.repo, 'number': data.issue.number }, function(error, pull) {
				if (error) {
					console.log(error);
					return;
				}

				pull.skip_comments = true;
				events.emit('pull_request', pull);
			});
		}
	});

	function checkFiles(pull) {
		GitHub.pullRequests.getFiles({ 'user': config.user, 'repo': config.repo, 'number': pull.number }, function(err, files) {
			if (err) {
				console.log(err);
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

				if (start != null && length != null) {
					file.ranges.push([ start, start + length, 1 + length + deletions.length, offset, deletions ]);
				}

				pull.files.push(file);
			});

			if (pull.files.length > 0) {
				mergeatron.emit('pull.found', pull);
			}
		});
	}

	function processPull(pull) {
		mergeatron.db.findPull(pull.number, function(error, item) {
			var new_pull = false,
				ssh_url = pull.head.repo.ssh_url,
				branch = 'origin/' + pull.head.label.split(':')[1];

			if (!item) {
				new_pull = true;
				mergeatron.db.insertPull(pull, function(err) {
					if (err) {
						console.log(err);
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
				mergeatron.db.updatePull(pull.number, { files: pull.files });
				pull.jobs = item.jobs;
			}

			if (new_pull || pull.head.sha != item.head) {
				mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
				return;
			}

			if (typeof pull.skip_comments != 'undefined' && pull.skip_comments) {
				mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
				return;
			}

			GitHub.issues.getComments({ user: config.user, repo: config.repo, number: pull.number, per_page: 100 }, function(error, resp) {
				for (var i in resp) {
					if (resp[i].created_at > item.updated_at && resp[i].body.indexOf('@' + config.auth.user + ' retest') != -1) {
						mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
						return;
					}
				}
			});
		});
	}

	function createStatus(sha, state, build_url, description) {
		GitHub.statuses.create({ user: config.user, repo: config.repo, sha: sha, state: state, target_url: build_url, description: description });
	}

	function setupServer() {
		http.createServer(function(request, response) {
			if (allowed_ips.indexOf(request.connection.remoteAddress) == -1) {
				response.writeHead(403, { 'Content-Type': 'text/plain' });
				response.end();
				return;
			}

			if (typeof request.headers['x-github-event'] == 'undefined' || allowed_events.indexOf(request.headers['x-github-event']) == -1) {
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
				events.emit(request.headers['x-github-event'], JSON.parse(data));
			});

			response.writeHead(200, { "Content-Type": "text/plain" });
			response.end();
		}).listen(config.port);
	}

	function setupPolling() {
		async.parallel({
			'github': function() {
				var run_github = function() {
					GitHub.pullRequests.getAll({ 'user': config.user, 'repo': config.repo, 'state': 'open' }, function(error, resp) {
						if (error) {
							console.log(error);
							return;
						}

						for (var i in resp) {
							var pull = resp[i],
								number = pull.number;

							if (!number || number == 'undefined') {
								continue;
							}

							events.emit('pull_request', pull);
						}
					});

					setTimeout(run_github, config.frequency);
				};

				run_github();
			}
		});
	}
};