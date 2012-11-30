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
	plugin_dirs: [ './plugins/' ],
	plugins: {
		github: {
			method: 'hooks',    // 'hooks' for webhooks or 'polling' to poll the REST API
			auth: {
				user: 'username',
				pass: 'password'
			},
			user: 'user-to-watch',
			repo: 'repo_name',
			skip_file_listing: false,
			frequency: 15000,    // only necessary if method is 'polling'
			port: '8888',        // only necessary if method is 'hooks'
			// optional. If running GitHub Enterprise this is the host/port to access the REST API.
			// Can be if just using github.com.
			api: {
				host: 'ghe.example.com',
				port: '1234'
			}
		},
		jenkins:  {
			token: 'token',
			user: false,
			pass: false,
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
