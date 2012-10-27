module.exports = function( grunt ) {

"use strict";

grunt.initConfig({
	lint: {
		options: [ "*.js", "plugins/*.js", "bin/*.js" ]
	},
	jshint: (function() {
		/* parserc adapted from the jQuery UI grunt file */
		function parserc( path ) {
			var rc = grunt.file.readJSON( (path || "") + ".jshintrc" ),
				settings = {
					options: rc,
					globals: {}
				};

			(rc.predef || []).forEach(function( prop ) {
				settings.globals[ prop ] = true;
			});
			delete rc.predef;

			return settings;
		}

		return {
			options: parserc()
		};
	})(),
	watch: {
		files: [ "<config:lint.options>" ],
		tasks: "default"
	}
});

grunt.registerTask( "default", "lint" );
};
