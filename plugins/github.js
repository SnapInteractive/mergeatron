var GitHubApi = require('github'),
	GitHub = new GitHubApi({ version: '3.0.0' }),
	async = require('async'),
	config = {},
	mergeatron = null;

exports.init = function(_config, _mergeatron) {
	config = _config;
	mergeatron = _mergeatron;

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

//						if (config.jenkins.rules) {
//							checkFiles(rules);
//						} else {
							processPull(pull);
//						}
					}
				});

				setTimeout(run_github, config.frequency);
			};

			run_github();
		}
	});
};

mergeatron.on('build', function(sha, ssh_url, branch, updated_at, triggered_by) {
	if (typeof triggered_by != undefined) {
		comment(pull.number, 'Got it @' + resp[i].user.login + '. Queueing up a new build.');
	}
});

function checkFiles(pull) {
	GitHub.pullRequests.getFiles({ 'user': config.github.user, 'repo': config.github.repo, 'number': pull.number }, function(err, files) {
		if (err) {
			console.log(err);
			return;
		}

		for (var x in files) {
			var file_name = files[x].filename;
			if (!file_name || file_name == 'undefined') {
				continue;
			}

			for (var y in config.jenkins.rules) {
				if (file_name.match(config.jenkins.rules[y])) {
					processPull(pull);
					return;
				}
			}
		}
	});
}

function processPull(pull) {
	mongo.pulls.findOne({ _id: pull.number }, function(error, item) {
		var new_pull = false,
			ssh_url = pull.head.repo.ssh_url,
			branch = 'origin/' + pull.head.label.split(':')[1];

		if (!item) {
			new_pull = true;
			mongo.pulls.insert({ _id: pull.number, created_at: pull.created_at, updated_at: pull.updated_at, head: pull.head.sha }, function(err) {
				console.log(err);
				process.exit(1);
			});
		}

		if (new_pull || pull.head.sha != item.head) {
			mergeatron.emit('build', pull.head.sha, ssh_url, branch, pull.updated_at);
//			buildPull(pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
			return;
		}

		GitHub.issues.getComments({ user: config.user, repo: config.repo, number: pull.number, per_page: 100 }, function(error, resp) {
			for (i in resp) {
				if (resp[i].created_at > item.updated_at && resp[i].body.indexOf('@' + config.auth.user + ' retest') != -1) {
					mergeatron.emit('build', pull.head.sha, ssh_url, branch, pull.updated_at, resp[i].user.login);
//					buildPull(pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
					return;
				}
			}
		});
	});
}

function comment(pull_number, comment) {
	GitHub.issues.createComment({ user: config.user, repo: config.repo, number: pull_number, body: comment });
}