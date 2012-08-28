var GitHubApi = require('github'),
	GitHub = new GitHubApi({ version: '3.0.0' }),
	async = require('async'),
	responses = require('./../responses').responses;

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

						checkFiles(pull);
					}
				});

				setTimeout(run_github, config.frequency);
			};

			run_github();
		}
	});

	mergeatron.on('build_process', function(pull) {
		processPull(pull);
	});

	mergeatron.on('build_started', function(job_id, pull_number, build_url) {
		comment(pull_number, 'Testing Pull Request\nBuild: ' + build_url);
	});

	mergeatron.on('build_failed', function(job_id, pull_number, build_url) {
		comment(pull_number,  responses.failure.randomValue() + "\n" + build_url);
	});

	mergeatron.on('build_succeeded', function(job_id, pull_number, build_url) {
		comment(pull_number, responses.success.randomValue());
	});

	function checkFiles(pull) {
		GitHub.pullRequests.getFiles({ 'user': config.user, 'repo': config.repo, 'number': pull.number }, function(err, files) {
			if (err) {
				console.log(err);
				return;
			}

			var file_names = [];
			for (var x in files) {
				var file_name = files[x].filename;
				if (!file_name || file_name == 'undefined') {
					continue;
				}

				file_names.push(file_name);
			}

			if (file_names.length > 0) {
				mergeatron.emit('build_check_files', pull, file_names);
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
				mergeatron.mongo.pulls.insert({ _id: pull.number, created_at: pull.created_at, updated_at: pull.updated_at, head: pull.head.sha }, function(err) {
					if (err) {
						process.exit(1);
					}
				});
			}

			if (new_pull || pull.head.sha != item.head) {
				mergeatron.emit('build_triggered', pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
				return;
			}

			GitHub.issues.getComments({ user: config.user, repo: config.repo, number: pull.number, per_page: 100 }, function(error, resp) {
				for (i in resp) {
					if (resp[i].created_at > item.updated_at && resp[i].body.indexOf('@' + config.auth.user + ' retest') != -1) {
						mergeatron.emit('build_triggered', pull.number, pull.head.sha, ssh_url, branch, pull.updated_at, resp[i].user.login);
						return;
					}
				}
			});
		});
	}

	function comment(pull_number, comment) {
		GitHub.issues.createComment({ user: config.user, repo: config.repo, number: pull_number, body: comment });
	}
};