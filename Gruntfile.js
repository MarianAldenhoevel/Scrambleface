/*
  Gruntfile to build ServiceBroker.
  
  The build process is mainly a step that copies files from ServiceBroker\ to 
  ServiceBroker\build. The build is implemented using grunt to stay within the 
  node universe toolkits.

  The buld selects files to copy and does not always copy the whole tree. 
*/

module.exports = function(grunt) {

	// Project configuration.
	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),

		// Clean task for all of the build-folder and a specific flavour.
		clean: ['./build/'],

		// Copy files to build folder
		copy: {
			all: {
				expand: true,
				src: [
					'package.json',
					'README',
					'ServiceBroker.js',
					'start.bat',
					'config/*', '!config/runtime.json',
					'resources/views/**/*.ejs',
					'resources/static/**/*',
					'modules/**/*.js',
					'modules/**/*.xml'
				],
				dest: 'build/'
			}
		},

		htmlmin: { // Task
			target: {
				options: { // Target options
					removeComments: true,
					collapseWhitespace: true,
					conservativeCollapse: true,
					collapseBooleanAttributes: true,
					removeTagWhitespace: true,
					removeAttributeQuotes: true,
					removeRedundantAttributes: true,
					minifyJS: true, // for JS left embedded
					minifyCSS: true, // for CSS left embedded
					minifyURLs: true
				},
				files: [{
					expand: true,
					cwd: './build/resources/base/views',
					src: ['**/*.ejs'],
					dest: './build/resources/base/views',
					filter: 'isFile',
					extDot: 'last',
					ext: '.ejs'
				}]
			}
		},

		// Create a logs folder so we can run in-place.
		mkdir: {
			all: {
				options: {
					create: ['build/logs']
				}
			}
		},

		// Check JS.
		jshint: {
			all: [
				'Gruntfile.js',
				'modules/**/*.js'
			]
		},

		// Pretty-Print.
		jsbeautifier: {
			files: [
				'Gruntfile.js',
				'modules/**/*.js'
			],
			options: {
				// mode:'VERIFY_ONLY',
				html: {
					braceStyle: "collapse",
					indentWithTabs: true,
					maxPreserveNewlines: 2,
					preserveNewlines: true,
					unformatted: ["a", "sub", "sup", "b", "i", "u"],
					wrapLineLength: 0
				},
				css: {
					indentWithTabs: true
				},
				js: {
					braceStyle: "collapse",
					breakChainedMethods: false,
					e4x: false,
					evalCode: false,
					indentWithTabs: true,
					jslintHappy: false,
					keepArrayIndentation: false,
					keepFunctionIndentation: false,
					maxPreserveNewlines: 2,
					preserveNewlines: true,
					spaceBeforeConditional: true,
					spaceInParen: false,
					unescapeStrings: false,
					wrapLineLength: 0,
					endWithNewline: true
				}
			}
		}
	});

	// Load required plugins
	grunt.loadNpmTasks('grunt-contrib-clean');
	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.loadNpmTasks('grunt-contrib-htmlmin');
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-mkdir');
	grunt.loadNpmTasks('grunt-jsbeautifier');

	// Tasks.
	grunt.registerTask('default', ['copy', 'htmlmin', 'mkdir']);
};
