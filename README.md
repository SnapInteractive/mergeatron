# Mergeatron

Mergeatron is a Node.js bot that monitors a GitHub account for new, and updated, Pull Requests. When it finds any it will kick off a Jenkins build and reply to the Pull Request with a thumbs up, or down, depending on success or failure.

Mergeatron is intended to assist with reviewing Pull Requests by providing, at a glance, information on whether or not it passes your automated tests.

## Requirements

 * [MongoDB](http://www.mongodb.org/)
 * [Node.js](http://nodejs.org/)
 * [NPM](https://npmjs.org/)

## Installation Instructions

```
	git clone git@github.com:SnapInteractive/mergeatron.git
	npm install

	// Copy config.sample.js to config.js and update accordingly
	node mergeatron.js
```

## Configuring Mergeatron

To configure Mergeatron copy the `config.sample.js` file to `config.js` in the same directory. The settings you will need to change are:

 * `mongo` - This is the connection string to use for mongo. For more information on this see the [mongojs](https://github.com/gett/mongojs) documentation.
 * `plugins_dir` - This is the directory where the plugins live. Chances are you won't need to change this.

Mergeatron comes with multiple different plugins you can opt to use. By default any plugin found in your `config.js` will be included and run. If you want to disable a certain plugin you can either remove it or add `enabled: false` to that plugins configuration.

 * `jenkins.token` - This is a token you setup with your project. In your job configuration, within Jenkins, look for the option labeled 'Trigger builds remotely (e.g., from scripts)'.
 * `jenkins.protocol` - Either `http` or `https` depending on your setup.
 * `jenkins.host - The host of the URL, without backslash, to your Jenkins install.
 * `jenkins.project` - The name of the project within Jenkins you want to build.
 * `jenkins.rules` - An array of regular expressions that will be run against each file name in the pull request. A jenkins build will only be triggered if at least one file matches at least one rule.
 * `jenkins.frequency` - The frequency, in milliseconds, to poll Jenkins for updated build information. Increasing this will increase the time between when a build is started and Mergeatron knows it finished. Decreasing it too low can cause your Jenkins server to come under heavy load.
 * `github.method` - Either "hooks" or "polling". If "hooks" you'll need to configure the `github.port` option and make sure this port is available to GitHub to post to. If "polling" you'll need to configure `github.frequency` for how often to poll their REST API.
 * `github.auth.user` - The username of the GitHub user Mergeatron will be logging in, and posting, as. This user must have visibility to your repos Pull Requests.
 * `github.auth.pass` - The password for the GitHub user Mergeatron will be using.
 * `github.user` - The user whose GitHub repo Mergeatron will be checking for Pull Requests. Does not need to be the same as the `github.auth.user` user.
 * `github.repo` - The repo you want Mergeatron to keep an eye on.
 * `github.frequency` - The frequency, in milliseconds, with which to poll GitHub for new and updated Pull Requests. Be mindful of your [API rate limit](http://developer.github.com/v3/#rate-limiting) when setting this.
 * `github.port` - The port you want to allow GitHub to post to.
 * `phpcs.artifact` - The name of the artifact file that contains PHP Code Sniffer results. If no artifact with this name is found the plugin won't do anything.

## Setting Up GitHub

There are two ways you can use the GitHub plugin. You can either have it poll GitHub's REST API periodically looking for changes. The downside to this approach is that it's very inefficienct, especially if you have a low volume of Pull Requests or if pull requests can sit for a while before being merged or closed. You also run into issues with rate limiting if you have too much activity or poll too frequently.

Alternatively you can use GitHub's webhooks and let them push new and updated pull requests to you. This is far more efficient but does mean you have to open a port for them to connect to. They provide the list of public IPs they post from so you can lock down the port for increased security.

To configure your setup for polling you need to set `github.method` to "polling" and will want to tweak the `github.frequency` setting to match how often you want to poll their API. Keep in mind they do have rate limiting so don't make it too frequent. The default here, or higher, should be pefectly fine.

To configure your setup for webhooks you need to set `github.method` to "hooks" and set `github.port` to the port number you're opening for them. You'll also need to setup he webhook with GitHub. You can execute `nodejs bin/github_setup.js` and provide the details it asks for to set one you. You'll want to read [their documentation](http://developer.github.com/v3/repos/hooks/) for more information on webhooks.

## Configuring Jenkins

To configure Jenkins you will need to make sure you have the appropriate git plugin installed. I'm assuming you already know how to do that and already have it up and running successfully. Once you do follow the below steps.

 * Check the box labeled 'This build is parameterized' and create the following string parameters:
  * REPOSITORY_URL - SSH Url to the git repo (default: git@github.com:`github.user/`github.repo`.git)
  * BRANCH_NAME - The name of the branch to use (default: origin/master)
  * JOB - The unique ID of each job. Jenkins doesn't return their ID so we have to use this to search for the job later
  * PULL - The id of the pull request
 * Check the box labeled 'Execute concurrent builds if necessary'.
 * Check the box labeled 'Trigger builds remotely (e.g., from scripts)' and enter the `jenkins.token` token you specified in your Mergeatron configs.
 * Provide the following shell script as a build step:

```shell
git reset --hard HEAD

git remote set-url origin ${REPOSITORY_URL}
git fetch origin

git checkout master
git pull upstream master

git checkout ${BRANCH_NAME}
git merge master
git clean -fdx

git remote prune origin
```

 * Update the above shell script to have the proper references to your master branch. You'll need to manually ensure that `origin` and `upstream` are created.

 ## Extending Mergeatron

 Mergeatron is built with extensibility in mind. To help achieve this it's been built around events instead of direct calls between plugins. This enables you to easily write any plugin you want that listens on the existing events and/or emits your own that others can use.

 Any file found in your configured `plugins_dir` directory is assumed to be a plugin and will be loaded unless disabled via your `config.js` file. To turn off a plugin just provide an entry for it under the `plugins` config with `enabled: false`. The file will then not be included.

 All plugins are expected to export an `init` function that is executed and passed two parameters. The first is your plugins config settings and the second is a `Mergeatron` object. The `Mergeatron` object contains a reference to mongo but, more importantly, is also an `EventEmitter`. You can bind your listeners to this object and use it to emit events.

 Below is a very basic example:

 ```javascript
 exports.init = function(config, mergeatron) {
 	// Do some stuff we want to execute once on startup/init

 	mergeatron.on('build.started', function(job_id, job, build_url) {
		console.log(job_id + ' has started building!');
 	});
 }
 ```

 ## Events

 * ''pull.found'' - This is the first event emitted in a builds life cycle. It allows any listening plugins to check the build to make sure it should be handled.
 * ''pull.validated'' - If a build should be acted upon this event will be emitted. It allows any listening plugins to setup the build for processing. This means persisting it to a temporary, or permenant, data store of their choice and doing any other setup work they need to.
 * ''pull.processed'' - Once a build has been pre-processed it is ready to be built. When that happens this event is emitted. Any listening plugins can start the build.
 * ''build.started'' - This event is emitted when the build has been started.
 * ''build.succeeded'' - This event is emitted when a build was successful.
 * ''build.failed'' - This event is emitted when a build has failed.
 * ''pull.inline_status'' - This event is emitted when a plugin is announcing that something was found on a specific line of a files diff within the build.
 * ''build.artifact_found'' - This event is emitted once for each artifact found after the build has finished. Plugins receive the URL to the artifact and can download and act upon it if wanted.

 ## Contributing

 * Please use topic branches when submitting pull requests. Please don't submit PR's from master.
 * Take care to follow the existing style. We have no formal style guide as of yet, but follow the idiomatic JS principle of: "All code in any code-base should look like a single person typed it, no matter how many people contributed."
 * We use `grunt` to manage the build. Make sure you run `grunt` before submitting a pull request, as this will run jshint on the code. If you want continuous linting on file save, use `grunt watch`.