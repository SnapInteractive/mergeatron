// Rename, or copy, to config.js in the same directory
exports.config = {
	db: {
		type: 'mongo',
		auth: {
			user: 'username',
			pass: 'password',
			host: 'localhost',
			port: 3306
		},
		database: 'mergeatron'
	},
	log_level: 'info',
	plugin_dirs: [ './plugins/' ],
	plugins: {
		github: {
			method: 'hooks',    // 'hooks' for webhooks or 'polling' to poll the REST API
			auth: {
				user: 'username',
				pass: 'password'
			},
			user: 'user-to-watch',
			repos: [ 'repo_name' ],
			retry_whitelist: [ 'user', 'user2' ],    // optional whitelist of those able to trigger retries
			skip_file_listing: false,
			frequency: 15000,    // only necessary if method is 'polling'
			port: '8888',        // only necessary if method is 'hooks'
			// optional. If running GitHub Enterprise this is the host/port to access the REST API.
			// Can be left out if just using github.com.
			api: {
				host: 'ghe.example.com',
				port: '1234'
			}
		},
		jenkins:  {
			user: false,
			pass: false,
			protocol: 'http',
			host: 'jenkins.yoururl.com:8080',
			projects: [{
				name: 'project_name',
				repo: 'repo_name',
				token: 'token',
				rules: [ new RegExp(/.php/g) ]
			}],
			frequency: 2000
		},
		phpcs: {
			enabled: false,
			artifact: 'artifacts/phpcs.csv'
		},
		phpunit: {
			enabled: false,
			artifact: 'artifacts/junit.xml',
			failure_limit: 3
		}
	}
};
