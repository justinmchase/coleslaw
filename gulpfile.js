var gulp = require('gulp')
var mocha = require('gulp-mocha')
var runSequence = require('run-sequence')

var paths = {
    scripts: [
        './gulpfile.js',
        './lib/**/*.js'
    ],
    tests: [
        './test/**/*.js',
        './test/**/*.cls'
    ]
}

gulp.task('test', () => {
	return gulp
        .src('test/**/*.js', {read: false}) 
		.pipe(mocha({reporter: 'nyan'}))
})

gulp.task('watch', () => {
    gulp.watch(
        [
            'test/**/*.js',
            'test/**/*.cls',
            'lib/**/*.js'
        ],
        ['test'])
        
    runSequence(['test'])
})

gulp.task('default', ['test'])