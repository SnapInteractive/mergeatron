/**
 * Simple polling plugin
 * @module GitHub
 */
"use strict";

var async = require('async'),
	emitter = require('events').EventEmitter,
	events = new emitter(),
	GitHubApi = require('github');

var GitHubPolling = function(config, mergeatron, events) {
	config.api = config.api || {};

    this.events = events;
	this.config = config;
	this.mergeatron = mergeatron;
	this.api = new GitHubApi({
		version: '3.0.0',
		host: config.api.host || null,
		port: config.api.port || null
	});

	this.api.authenticate(config.auth);
};

GitHubPolling.prototype.validateRef = function(payload) {
	this.mergeatron.log.info('Evaluating event #' + payload.id);
	this.mergeatron.log.debug(payload);

    var self = this;
    this.mergeatron.db.findEvent({ ref: payload.ref, head: payload.head, after: payload.after }, function(err, res) {
        if (err) {
            self.mergeatron.log.error(err);
        }

        // exact match for payload found
        if (res) {
            return;
        }

        self.mergeatron.db.insertEvent(payload);
        self.mergeatron.emit('events.ref_update', payload.repo, payload.ref, payload.master_branch, payload.head, payload.after, payload.email);
    });
};

GitHubPolling.prototype.checkEvents = function() {
	this.mergeatron.log.debug('Polling for github events');

	var self = this;
	this.config.repos.forEach(function(repo) {
		self.api.events.getFromRepo({ 'user': self.config.user, 'repo': repo }, function(err, repoEvents) {
            if (err) {
                self.mergeatron.log.error('Error fetching events: ' + err);
                return;
            }

            repoEvents.forEach(function(event) {
                if ([ 'PushEvent', 'CreateEvent' ].indexOf(event.type) === -1) {
                    return;
                }

                if (event.type === 'CreateEvent' && event.payload.ref_type !== 'branch') {
                    self.mergeatron.log.info('CreateEvent did not have a ref_type === "branch", skipping', null);
                    return;
                }

                self.mergeatron.log.debug('Event found: ' + event);
                self.events.emit('ref_event', event);
            });
        });
	});
};

GitHubPolling.prototype.buildPayload = function(event) {

    var payload = {
        id: event.id,
        repo: event.repo.name,
        actor_id: event.actor.id,
        ref: event.payload.ref,
        master_branch: null,
        head: null,
        after: null,
        email: null
    };

    if (event.type === 'CreateEvent') {
        payload.master_branch = event.payload.master_branch;
    }

    if (event.type === 'PushEvent') {
        payload.ref = payload.ref.split('/').pop();
        payload.head = event.payload.head;
        payload.after = event.payload.after;
    }

    var self = this;
    this.mergeatron.db.findMasterEvent(payload.ref, function(err, res) {
        if (err) {
            self.mergeatron.log.error(err);
            process.exit(1);
        }

        payload.master_branch = (!res) ? null : res.master_branch;
        self.api.users.getEmails(event.actor, function(err, emails) {
            emails.forEach(function(email) {
              if (email.primary) {
                  payload.email = email.email;
              }
            });
            if (payload.email === null) {
                payload.email = emails.pop().email || emails.pop();
            }

            self.events.emit('payload_built', payload);
        });
    });
};


GitHubPolling.prototype.setup = function() {
    var self = this;
    async.parallel({
        'github': function() {
            var run_github = function() {
                self.checkEvents();
                setTimeout(run_github, self.config.frequency);
            };

            run_github();
        }
    });
};

exports.init = function(config, mergeatron) {
	var poller = new GitHubPolling(config, mergeatron);
	poller.setup();

    events.on('ref_event', function(event) {
        poller.buildPayload(event);
    });
    events.on('payload_built', function(payload) {
        poller.validateRef(payload);
    });
};
