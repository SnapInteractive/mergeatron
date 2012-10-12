var GitHubApi = require('github'),
	GitHub = new GitHubApi({ version: '3.0.0' }),
	async = require('async');

exports.init = function(config, mergeatron) {
	GitHub.authenticate({
		type: 'basic',
		username: config.auth.user,
		password: config.auth.pass
	});

	async.parallel({
		'github': function() {
			var run_github = function() {
				GitHub.pullRequests.getAll({ 'user': config.user, 'repo': config.repo, 'state': 'open' }, function(error, resp) {
					if (error) {
						console.log(error);
						return;
					}

					for (i in resp) {
						var pull = resp[i],
							number = pull.number;

						if (!number || number == 'undefined') {
							continue;
						}

						if (pull.body && pull.body.indexOf('@' + config.auth.user + ' ignore') != -1) {
							continue;
						}

						if (config.skip_file_listing) {
							pull.files = [];
							mergeatron.emit('pull.found', pull);
						} else {
							checkFiles(pull);
						}
					}
				});

				setTimeout(run_github, config.frequency);
			};

			run_github();
		}
	});

	mergeatron.on('pull.validated', function(pull) {
		processPull(pull);
	});

	mergeatron.on('build.started', function(job, pull, build_url) {
		createStatus(job['head'], 'pending', build_url, 'Testing Pull Request');
	});

	mergeatron.on('build.failed', function(job, pull, build_url) {
		createStatus(job['head'], 'failure', build_url, 'Build failed');
	});

	mergeatron.on('build.succeeded', function(job, pull, build_url) {
		createStatus(job['head'], 'success', build_url, 'Build succeeded');
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
					offset = 0.
					line_number = 0;

				file.ranges = [];
				file.reported = [];
				file.sha = file.blob_url.match(/blob\/([^\/]+)/)[1];
				file.patch.split('\n').forEach(function(line) {
					var matches = line.match(/^@@ -\d+,\d+ \+(\d+),(\d+) @@/);
					if (matches) {
						if (start == null && length == null) {
							start = parseInt(matches[1]);
							length = parseInt(matches[2]);
							line_number = start;
						} else {
							// The one is for the line in the diff block containing the line numbers
							modified_length = 1 + length + deletions.length;
							file.ranges.push([ start, start + length, modified_length, offset, deletions ]);

							deletions = [];
							start = parseInt(matches[1]);
							length = parseInt(matches[2]);
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
		mergeatron.mongo.pulls.findOne({ _id: pull.number }, function(error, item) {
			var new_pull = false,
				ssh_url = pull.head.repo.ssh_url,
				branch = 'origin/' + pull.head.label.split(':')[1];

			if (!item) {
				new_pull = true;
				mergeatron.mongo.pulls.insert({ _id: pull.number, number: pull.number, created_at: pull.created_at, updated_at: pull.updated_at, head: pull.head.sha, files: pull.files }, function(err) {
					if (err) {
						console.log(err);
						process.exit(1);
					}
				});
				pull.jobs = [];
			} else {
				// Before updating the list of files in mongo we need to make sure the set of reported lines is saved
				item.files.forEach(function(file) {
					pull.files.forEach(function(pull_file, i) {
						if (pull_file.filename == file.filename) {
							pull.files[i].reported = file.reported;
						}
					});
				});
				mergeatron.mongo.pulls.update({ _id: pull.number }, { $set: { files: pull.files } });
				pull.jobs = item.jobs;
			}

			if (new_pull || pull.head.sha != item.head) {
				mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
				return;
			}

			GitHub.issues.getComments({ user: config.user, repo: config.repo, number: pull.number, per_page: 100 }, function(error, resp) {
				for (i in resp) {
					if (resp[i].created_at > item.updated_at && resp[i].body.indexOf('@' + config.auth.user + ' retest') != -1) {
						mergeatron.emit('pull.processed', pull, pull.number, pull.head.sha, ssh_url, branch, pull.updated_at, resp[i].user.login);
						return;
					}
				}
			});
		});
	}

	function createStatus(sha, state, build_url, description) {
		GitHub.statuses.create({ user: config.user, repo: config.repo, sha: sha, state: state, target_url: build_url, description: description });
	}
};