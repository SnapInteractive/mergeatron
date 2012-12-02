"use strict";

module.exports = function( grunt ) {

grunt.initConfig({
	jshint: {
		files: [ "*.js", "plugins/*.js", "bin/*.js" ],
		options: {
			jshintrc: ".jshintrc"
		}
	},
	nodeunit: {
		tests: ['test/*_test.js']
	},
	watch: {
		files: [ "<%= jshint.files %>" ],
		tasks: [ "default" ]
	}
});


grunt.loadNpmTasks('grunt-contrib-jshint');
grunt.loadNpmTasks('grunt-contrib-nodeunit');
grunt.loadNpmTasks('grunt-contrib-watch');

grunt.registerTask( "default", ["jshint", "nodeunit"] );

};
