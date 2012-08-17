var config = require('./config').config,
	responses = require('./responses').responses,
	request = require('request'),
	url = require('url'),
	uuid = require('node-uuid'),
	async = require('async'),
	mongo = require('mongojs').connect(config.mongo, ['pulls', 'jobs']),
	fs = require('fs'),
	events = require('events');

Array.prototype.randomValue = function() {
	return this[Math.floor(Math.random() * this.length)];
};

var Mergeatron = function() {};
Mergeatron.prototype = new events.EventEmitter;
mergeatron = new Mergeatron();

fs.readdir(config.plugins_dir, function(err, files) {
	if (err) {
		console.log(err);
		return;
	}

	for (var i = 0, l = files.length; i < l; i++) {
		var filename = config.plugins_dir + files[i],
			pluginName = files[i].split('.', 2)[0],
			conf = { enabled: true };

		console.log('Loading plugin: ' + pluginName);

		if (config.plugins && config.plugins[pluginName]) {
			conf = config.plugins[pluginName];
		}

		if (conf.enabled == undefined || conf.enabled) {
			console.log(conf);
			require(filename).init(conf, mergeatron);
		} else {
			console.log('Not loading disabled plugin ' + pluginName);
		}
	}
});

async.parallel({
	'jenkins': function() {
		var run_jenkins = function() {
			mongo.jobs.find({ status: { $ne: 'finished' } }).forEach(function(err, item) {
				if (err) {
					console.log(err);
					process.exit(1);
				}

				if (!item) { return; }
				checkJob(item['_id']);
			});

			setTimeout(run_jenkins, config.jenkins.frequency);
		};

		run_jenkins();
	}
});

function buildPull(number, sha, ssh_url, branch, updated_at) {
	var job_id = uuid.v1(),
		options = {
		url: url.format({
			protocol: config.jenkins.protocol,
			host: config.jenkins.host,
			pathname: '/job/' + config.jenkins.project + '/buildWithParameters',
			query: {
				token: config.jenkins.token,
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

		mongo.pulls.update({ _id: number }, { $set: { head: sha, updated_at: updated_at } });
		mongo.jobs.insert({ _id: job_id, pull: number, status: 'new' });

		checkJob(job_id);
	});
}

function checkJob(job_id) {
	var options = {
		url: url.format({
			protocol: config.jenkins.protocol,
			host: config.jenkins.host,
			pathname: '/job/' + config.jenkins.project + '/api/json',
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
					mongo.jobs.findOne({ _id: job_id }, function(error, job) {
						if (job['status'] == 'new') {
							comment(job['pull'], "Testing Pull Request\nBuild: " + build['url']);
							mongo.jobs.update({ _id: job_id }, { $set: { status: 'started' } });
						}

						if (job['status'] != 'finished') {
							if (build['result'] == 'FAILURE') {
								comment(job['pull'],  responses.failure.randomValue() + "\n" + build['url'] + '/console');
								mongo.jobs.update({ _id: job_id }, { $set: { status: 'finished' } });
							} else if (build['result'] == 'SUCCESS') {
								comment(job['pull'], responses.success.randomValue());
								mongo.jobs.update({ _id: job_id }, { $set: { status: 'finished' } });
							}
						}
					});
				}
			});
		});
	});
}