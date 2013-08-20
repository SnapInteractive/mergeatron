"use strict";

var config = require('./config').config.db;
exports.init = function() {

	// mongo abstraction layer
	var MongoDB = function() {
		this.connection = require('mongojs').connect(config.database, config.collections);
	};

	// pull methods
	MongoDB.prototype.findPull = function(pull_number, pull_repo, callback) {
		this.connection.pulls.findOne({ number: pull_number, repo: pull_repo }, callback);
	};

	MongoDB.prototype.updatePull = function(pull_number, pull_repo, update_columns) {
		this.connection.pulls.update({ number: pull_number, repo: pull_repo }, { $set: update_columns });
	};

	MongoDB.prototype.insertPull = function(pull, callback) {
		this.connection.pulls.insert({
			number: pull.number,
			repo: pull.repo,
			created_at: pull.created_at,
			updated_at: pull.updated_at,
			head: pull.head.sha,
			files: pull.files
		}, callback);
	};

	MongoDB.prototype.findPullsByJobStatus = function(statuses, callback) {
		this.connection.pulls.find({ 'jobs.status': { $in: statuses }}).forEach(callback);
	};

	// job methods
	MongoDB.prototype.insertJob = function(pull, job) {
		if (typeof pull.jobs == 'undefined') {
			pull.jobs = [];
		}

		pull.jobs.push(job);

		this.updatePull(pull.number, pull.repo, { jobs: pull.jobs});
	};

	MongoDB.prototype.updateJobStatus = function(job_id, status) {
		this.connection.pulls.update({ 'jobs.id': job_id }, { $set: { 'jobs.$.status': status }});
	};

	// inline status methods
	MongoDB.prototype.insertLineStatus = function(pull, filename, line_number) {
		this.connection.pulls.update({ _id: pull.number, 'files.filename': filename }, { $push: { 'files.$.reported': line_number } });
	};

	// MySQL abstraction layer
	var MySQL = function() {
		this.connection = require('mysql').createConnection({
			host: config.auth.host,
			user: config.auth.user,
			password: config.auth.pass,
			database: config.database
		});
	};

	// pull methods
	MySQL.prototype.findPull = function(pull_number, pull_repo, callback) {
		this.connection.query('SELECT pulls.*, jobs.status, jobs.id as job_id, jobs.head as jobs_head FROM pulls LEFT JOIN jobs ON pulls.number = jobs.pull_number WHERE pulls.number = ? AND pulls.repo = ?', [ pull_number, pull_repo ], function (err, result){
			var response;
			if (result.length) {
				response = result[0];
				response.files = JSON.parse(response.files);
				response.jobs = [];
				result.forEach(function(row) {
					response.jobs.push({
						id: row.job_id,
						status: row.status,
						head: row.head
					});
				});
			}
			callback(err, response);
		});
	};

	MySQL.prototype.updatePull = function(pull_number, pull_repo, update_columns) {
		if (update_columns.files && typeof update_columns.files !== 'string'){
			update_columns.files = JSON.stringify(update_columns.files);
		}
		this.connection.query('UPDATE pulls SET ? WHERE numbers = ? AND repo = ?', [ update_columns, pull_number, pull_repo ]);
	};

	MySQL.prototype.insertPull = function(pull, callback) {
		this.connection.query('INSERT INTO pulls SET ?', {
			number: pull.number,
			repo: pull.repo,
			created_at: pull.created_at,
			updated_at: pull.updated_at,
			head: pull.head.sha,
			files: JSON.stringify(pull.files)
		}, callback);
	};

	MySQL.prototype.findPullsByJobStatus = function(statuses, callback) {
		this.connection.query('SELECT pulls.*, jobs.status, jobs.id as job_id, jobs.head as job_head FROM pulls LEFT JOIN jobs ON pulls.number = jobs.pull_number WHERE jobs.status IN (?) ORDER BY pulls.id ASC', [ statuses ], function (err, result){
			if (!result.length){
				return;
			}

			var new_result = [],
				new_row,
				cur_pull;

			result.forEach(function(row) {
				if(cur_pull != row.number){
					if(new_row){
						new_result.push(new_row);
					}
					new_row = row;
					new_row.jobs = [];
					cur_pull = row.number;
				}

				new_row.jobs.push({
					id: row.job_id,
					status: row.status,
					head: row.job_head
				});
			});

			new_result.push(new_row);

			new_result.forEach(function(row){
				callback(err, row);
			});
		});
	};

	// job methods
	MySQL.prototype.insertJob = function(pull, job, callback) {
		job.pull_number = pull.number;
		this.connection.query('INSERT INTO jobs SET ?', [ job ], callback);
	};

	MySQL.prototype.updateJobStatus = function(job_id, status) {
		this.connection.query('UPDATE jobs SET status = ? WHERE id = ?', [ status, job_id ]);
	};

	// inline status methods
	MySQL.prototype.insertLineStatus = function(/* pull_number, filename, line_number */) {
		// todo: implement
	};


	if (config.type === 'mongo') {
		return new MongoDB();
	} else if (config.type === 'mysql') {
		return new MySQL();
	}
};
