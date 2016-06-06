var coleslaw = require('../..')
var chai = require('chai')
var assert = chai.assert
var should = chai.should()
var expect = chai.expect

describe('steps', () => {
    var definitions = []
    var pipeline = []
    beforeEach(() => {
        definitions = []
        pipeline = []
    })
    
    it ('should succeed with no steps', (done) => {
        coleslaw.build(definitions, pipeline, done)
    })
    it ('should execute a single step', (done) => {
        pipeline.push((context, callback) => {
            context.success = true
            callback()
        })
        coleslaw.build(definitions, pipeline, (err, context) => {
            if (err) return done(err)
            context.success.should.be.true
            done()
        })
    })
    it ('should execute multiple steps', (done) => {
        pipeline.push((context, callback) => {
            context.one = true
            callback()
        })
        pipeline.push((context, callback) => {
            context.two = true
            callback()
        })
        coleslaw.build(definitions, pipeline, (err, context) => {
            if (err) return done(err)
            context.one.should.be.true
            context.two.should.be.true
            done()
        })
    })
    it ('should execute steps in order', (done) => {
        var order = []
        pipeline.push((context, callback) => {
            order.push(1)
            callback()
        })
        pipeline.push((context, callback) => {
            order.push(2)
            callback()
        })
        coleslaw.build(definitions, pipeline, (err, context) => {
            if (err) return done(err)
            order.should.deep.equal([1,2])
            done()
        })
    })
    it ('should return an error when the first step returns an error', (done) => {
        pipeline.push((context, callback) => {
            callback('error')
        })
        pipeline.push((context, callback) => {
            assert.fail()
        })
        coleslaw.build(definitions, pipeline, (err, context) => {
            err.should.equal('error')
            done()
        })
    })
    it ('should return an error when a subsequent step returns an error', (done) => {
        pipeline.push((context, callback) => {
            context.first = true
            callback()
        })
        pipeline.push((context, callback) => {
            callback('error')
        })
        coleslaw.build(definitions, pipeline, (err, context) => {
            err.should.equal('error')
            done()
        })
    })
    it ('should pass thrown errors to the callback', (done) => {
        pipeline.push((context, callback) => {
            throw 'error'
        })
        coleslaw.build(definitions, pipeline, (err) => {
            err.should.equal('error')
            done()
        })
    })
    it ('should return no error if all steps succeed', (done) => {
        var pass = (context, callback) => { callback() };
        pipeline.push(pass)
        pipeline.push(pass)
        pipeline.push(pass)
        coleslaw.build(definitions, pipeline, (err, context) => {
            expect(err).to.be.null
            expect(context).to.be.ok
            done()
        })
    })
})