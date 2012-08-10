#Mergeatron

Mergeatron is a Node.JS bot that monitors a GitHub account for new, and updated, Pull Requests. When it finds any it will kick off a Jenkins build and reply to the Pull Request with a thumbs up, or down, depending on success or failure.

Mergeatron is intended to assist with reviewing Pull Requests by providing, at a glance, information on whether or not it passes your automated tests.

##Requirements

 * MongoDB
 * Node.JS GitHub Module
 * Node.JS MongoDB Module
 * Node.JS MongoJS Module
 * Node.JS Request Module
 * Node.JS UUID Module
 * Node.JS async Module

##Installation Instructions

```
	git clone git@github.com:steves/mergeatron.git
	npm install github
	npm install mongodb
	npm install mongojs
	npm install request
	npm install node-uuid
	npm install async

	// Copy config.sample.js to config.js and update accordingly
	node mergeatron.js
```

## Configuring Mergeatron

To configure Mergeatron copy the `config.sample.js` file to `config.js` in the same directory. The settings you will need to change are:

 * `mongo` - This is the connection string to use for mongo. For more information on this see the [mongojs](https://github.com/gett/mongojs) documentation.
 * `jenkins.token` - This is a token you setup with your project. In your job configuration, within Jenkins, look for the option labeled 'Trigger builds remotely (e.g., from scripts)'.
 * `jenkins.protocol` - Either `http` or `https` depending on your setup.
 * `jenkins.host - The host of the URL, without backslash, to your Jenkins install.
 * `jenkins.project` - The name of the project within Jenkins you want to build.
 * `jenkins.frequency` - The frequency, in milliseconds, to poll Jenkins for updated build information. Increasing this will increase the time between when a build is started and Mergeatron knows it finished. Decreasing it too low can cause your Jenkins server to come under heavy load.
 * `github.auth.username` - The username of the GitHub user Mergeatron will be logging in, and posting, as. This user must have visibility to your repos Pull Requests.
 * `github.auth.password` - The password for the GitHub user Mergeatron will be using.
 * `github.user` - The user whose GitHub repo Mergeatron will be checking for Pull Requests. Does not need to be the same as the `github.auth.username` user.
 * `github.repo` - The repo you want Mergeatron to keep an eye on.
 * `github.frequency` - The frequency, in milliseconds, with which to poll GitHub for new and updated Pull Requests.
 
## Configuring Jenkins

To configure Jenkins you will need to make sure you have the appropriate git plugin installed. I'm assuming you already know how to do that and already have it up and running successfully. Once you do follow the below steps.

 * Check the box labeled 'This build is parameterized' and create the following string parameters:
  * REPOSITORY_URL - SSH Url to the git repo (default: git@github.com:`github.user/`github.repo`.git)
  * BRANCH_NAME - The name of the branch to use (default: origin/master)
  * JOB - The unique ID of each job. Jenkins doesn't return their ID so we have to use this to search for the job later
  * PULL - The id of the pull request
 * Check the box labeled 'Execute concurrent builds if necessary'.
 * Enter `$REPOSITORY_URL` as your Repository URL under the git configs.
 * Enter `$BRANCH_NAME` as the Branch Specifier under the git configs.
 * Check the box labeled 'Trigger builds remotely (e.g., from scripts)' and enter the `jenkins.token` token you specified in your Mergeatron configs.