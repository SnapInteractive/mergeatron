"use strict";

var request = require('request'),
	readline = require('readline'),
	url = require('url');

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

rl.question('Please enter the URL of the webhook', function(hook_url) {
	rl.question('Please enter your login credentials (username:password format)', function(auth) {
		rl.question('Which repo would you like to add the hook to (username/repo format)', function(repo) {
			var options = {
				url: url.format({
					protocol: 'https',
					host: 'api.github.com',
					pathname: '/repos/' + repo + '/hooks'
				}),
				method: 'POST',
				json: {
					name: 'web',
					active: true,
					events: [ 'pull_request', 'issue_comment' ],
					config: {
						url: hook_url,
						content_type: 'json'
					}
				},
				headers: {
					authorization: 'Basic ' + (new Buffer(auth, 'ascii').toString('base64')),
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.8; rv:20.0) Gecko/20100101 Firefox/20.0'
				}
			};

			request(options, function(error, response) {
				if (error || response.headers.status !== '201 Created') {
					console.log(error || response.body.message);
					process.exit(1);
				} else {
					console.log('Webhook created successfully');
					process.exit();
				}
			});
		});
	});
});
