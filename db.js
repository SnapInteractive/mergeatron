"use strict";

var config = require('./config').config.db;
exports.init = function() {

	// mongo abstraction layer
	var MongoDB = function() {
		this.connection = require('mongojs').connect(config.database, ['pulls']);
	};

	// pull methods
	MongoDB.prototype.findPull = function(pull_number, callback) {
		this.connection.pulls.findOne({ _id: pull_number }, callback);
	};

	MongoDB.prototype.updatePull = function(pull_number, update_columns) {
		this.connection.pulls.update({ _id: pull_number }, { $set: update_columns });
	};

	MongoDB.prototype.insertPull = function(pull, callback) {
		this.connection.pulls.insert({
			_id: pull.number,
			number: pull.number,
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

		this.updatePull(pull.number, { jobs: pull.jobs});
	};

	MongoDB.prototype.updateJobStatus = function(job_id, status) {
		this.connection.pulls.update({ 'jobs.id': job_id }, { $set: { 'jobs.$.status': status }});
	};

	// inline status methods
	MongoDB.prototype.insertLineStatus = function(pull_number, filename, line_number) {
		this.connection.pulls.update({ _id: pull_number, 'files.filename': filename }, { $push: { 'files.$.reported': line_number } });
	};


	if (config.type === 'mongo') {
		return new MongoDB();
	}
};