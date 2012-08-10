// Rename, or copy, to config.js in the same directory
exports.config = {
	mongo: 'mergeatron',
	jenkins:  {
		token: 'token',
		protocol: 'http',
		host: 'jenkins.yoururl.com:8080',
		project: 'project_name',
		frequency: 2000
	},
	github: {
		auth: {
			user: 'username',
			pass: 'password'
		},
		user: 'user-to-watch',
		repo: 'repo_name',
		frequency: 2000
	}
};
