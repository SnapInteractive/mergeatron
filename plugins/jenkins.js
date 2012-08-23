var request = require('request'),
	url = require('url'),
	uuid = require('node-uuid'),
	async = require('async');

exports.init = function(config, mergeatron) {
	async.parallel({
		'jenkins': function() {
			var run_jenkins = function() {
				mergeatron.mongo.pulls.find({ 'jobs.status': { $in: ['new', 'started'] }}).forEach(function(err, pull) {
					if (err) {
						console.log(err);
						process.exit(1);
					}

					if (!pull) { return; }
					checkJob(pull);
				});

				setTimeout(run_jenkins, config.frequency);
			};

			run_jenkins();
		}
	});

	mergeatron.on('build.triggered', function(pull, pull_number, sha, ssh_url, branch, updated_at, triggered_by) {
		buildPull(pull, pull_number, sha, ssh_url, branch, updated_at);
	});

	mergeatron.on('build.validate', function(pull) {
		if (!config.rules) {
			mergeatron.emit('build.process', pull);
			return;
		}

		for (var x in pull.files) {
			if (!pull.files[x].filename || typeof pull.files[x].filename != 'string') {
				continue;
			}

			for (var y in config.rules) {
				if (pull.files[x].filename.match(config.rules[y])) {
					mergeatron.emit('build.process', pull);
					return;
				}
			}
		}
	});

	/**
	 * @todo Do we need to pass all these parameters, is just passing pull enough?
	 */
	function buildPull(pull, number, sha, ssh_url, branch, updated_at) {
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

			if (typeof pull.jobs == 'undefined') {
				pull.jobs = [];
			}

			pull.jobs.push({
				id: job_id,
				status: 'new',
				head: sha
			});

			mergeatron.mongo.pulls.update({ _id: number }, { $set: { head: sha, updated_at: updated_at, jobs: pull.jobs } });
		});
	}

	function checkJob(pull) {
		var job = findUnfinishedJob(pull),
			options = {
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
				if (typeof build.actions == 'undefined' || typeof build.actions[0].parameters == 'undefined' || !build.actions[0].parameters) {
					return;
				}

				build.actions[0].parameters.forEach(function(param) {
					if (param['name'] == 'JOB' && param['value'] == job.id) {
						if (job.status == 'new') {
							mergeatron.mongo.pulls.update({ 'jobs.id': job.id }, { $set: { 'jobs.$.status': 'started' } });
							mergeatron.emit('build.started', job, pull, build['url']);
						}

						if (job.status != 'finished') {
							if (build['result'] == 'FAILURE') {
								mergeatron.mongo.pulls.update({ 'jobs.id': job.id }, { $set: { 'jobs.$.status': 'finished' } });
								mergeatron.emit('build.failed', job, pull, build['url'] + 'console');

								processArtifacts(build, pull);
							} else if (build['result'] == 'SUCCESS') {
								mergeatron.mongo.pulls.update({ 'jobs.id': job.id }, { $set: { 'jobs.$.status': 'finished' } });
								mergeatron.emit('build.succeeded', job, pull, build['url']);

								processArtifacts(build, pull);
							}
						}
					}
				});
			});
		});
	}

	function processArtifacts(build, pull) {
		var options = {
			url: url.format({
				protocol: config.protocol,
				host: config.host,
				pathname: '/job/' + config.project + '/' + build['number'] + '/api/json',
				query: {
					tree: 'artifacts[fileName,relativePath]'
				},
			}),
			json: true
		};

		request(options, function(err, response) {
			if (err) {
				console.log(err);
				return;
			}

			var artifacts = response.body.artifacts;
			for (var i in artifacts) {
				artifacts[i]['url'] = build['url'] + 'artifact/' + artifacts[i]['relativePath'];
				mergeatron.emit('artifact.found', build, pull, artifacts[i]);
			}
		});
	}

	function findUnfinishedJob(pull) {
		for (var x in pull.jobs) {
			if (pull.jobs[x].status != 'finished') {
				return pull.jobs[x];
			}
		}
	}
};