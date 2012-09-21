// Rename, or copy, to config.js in the same directory
exports.config = {
	mongo: 'mergeatron',
	plugin_dirs: [ './plugins/' ],
	plugins: {
		github: {
			auth: {
				user: 'username',
				pass: 'password'
			},
			user: 'user-to-watch',
			repo: 'repo_name',
			frequency: 15000
		},
		jenkins:  {
			token: 'token',
			protocol: 'http',
			host: 'jenkins.yoururl.com:8080',
			project: 'project_name',
			rules: [ new RegExp(/.php/g) ],
			frequency: 2000
		},
		phpcs: {
			artifact: 'artifacts/phpcs.csv'
		}
	}
};
