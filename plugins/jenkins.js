var request = require('request'),
	url = require('url'),
	uuid = require('node-uuid'),
	async = require('async');

exports.init = function(config, mergeatron) {
	async.parallel({
		'jenkins': function() {
			var run_jenkins = function() {
				mergeatron.mongo.jobs.find({ status: { $ne: 'finished' } }).forEach(function(err, item) {
					if (err) {
						process.exit(1);
					}

					if (!item) { return; }
					checkJob(item['_id']);
				});

				setTimeout(run_jenkins, config.frequency);
			};

			run_jenkins();
		}
	});

	mergeatron.on('build_triggered', function(pull_number, sha, ssh_url, branch, updated_at, triggered_by) {
		buildPull(pull_number, sha, ssh_url, branch, updated_at);
	});

	mergeatron.on('build_check_files', function(pull, files) {
		for (var x in files) {
			if (!files[x] || typeof files[x] != 'string') {
				continue;
			}

			for (var y in config.rules) {
				if (files[x].match(config.rules[y])) {
					mergeatron.emit('build_process', pull);
					return;
				}
			}
		}
	});

	function buildPull(number, sha, ssh_url, branch, updated_at) {
		var job_id = uuid.v1(),
			options = {
			url: url.format({
				protocol: config.protocol,
				host: config.host,
				pathname: '/job/' + config.project + '/buildWithParameters',
				query: {
					token: config.token,
					cause: 'Testing Pull Request: ' + number,
					REPOSITORY_URL: ssh_url,
					BRANCH_NAME: branch,
					JOB: job_id,
					PULL: number
				}
			}),
			method: 'GET',
		};

		request(options, function(error, response, body) {
			if (error) {
				console.log(error);
				return;
			}

			mergeatron.mongo.pulls.update({ _id: number }, { $set: { head: sha, updated_at: updated_at } });
			mergeatron.mongo.jobs.insert({ _id: job_id, pull: number, status: 'new' });

			checkJob(job_id);
		});
	}

	function checkJob(job_id) {
		var options = {
			url: url.format({
				protocol: config.protocol,
				host: config.host,
				pathname: '/job/' + config.project + '/api/json',
				query: {
					tree: 'builds[number,url,actions[parameters[name,value]],building,result]'
				},
			}),
			json: true
		};

		request(options, function(error, response) {
			response.body.builds.forEach(function(build) {
				if (typeof build.actions == undefined || typeof build.actions[0].parameters == undefined || !build.actions[0].parameters) {
					return;
				}

				build.actions[0].parameters.forEach(function(param) {
					if (param['name'] == 'JOB' && param['value'] == job_id) {
						mergeatron.mongo.jobs.findOne({ _id: job_id }, function(error, job) {
							if (job['status'] == 'new') {
								mergeatron.mongo.jobs.update({ _id: job_id }, { $set: { status: 'started' } });
								mergeatron.emit('build_started', job_id, job['pull'], build['url']);
							}

							if (job['status'] != 'finished') {
								if (build['result'] == 'FAILURE') {
									mergeatron.mongo.jobs.update({ _id: job_id }, { $set: { status: 'finished' } });
									mergeatron.emit('build_failed', job_id, job['pull'], build['url']);
								} else if (build['result'] == 'SUCCESS') {
									mergeatron.mongo.jobs.update({ _id: job_id }, { $set: { status: 'finished' } });
									mergeatron.emit('build_succeeded', job_id, job['pull'], build['url']);
								}
							}
						});
					}
				});
			});
		});
	}
};