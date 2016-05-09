# Coleslaw

Coleslaw is a Domain Specific Language (DSL) and related tools, for designing and creating Models.

## Installing
```bash
$ npm install coleslaw --save
```

## Usage
This library has 2 main apis:
- Model compilation
- Model building

The compilation step converts your model code into into model definition objects. Next you pass these model definitions into builders.

This library also contains the main Model builder.

### Author a model
```javascript
// example.cls
model Example {
    field auto id eid: string
    field name: string

    validate eid: uuid
    validate name: alphanum, required

    authorize allow ? update

    child tests: Test // 1:Many relationship with the Test model
}

module.exports = Example
```

The coleslaw language inherits from ecmascript 5. Which means that it _is_ ecmascript with the addition of the `model` statement.

### Compile your model
During your build process, or at runtime, you can compile a model into javascript which can then be `require`d or `eval`'d.
```javascript
var fs = require('fs')
var path = require('path')
var coleslaw = require('coleslaw')

var content = fs.readFileSync(path.join(__dirname, 'example.cls'), 'utf8')
coleslaw.compile(content, (err, code) => {
    if (err) throw err
    fs.saveFileSync('./example.js', code)
    var Example = require('./example')
    
    // or you could eval(code)
})
```

The resulting code is a plain javascript object representing the model described. This model can be used by various coleslaw builders.

## Model Builders
- [gulp-coleslaw](http://npmjs.org/package/gulp-coleslaw) Compiles your model definitions with gulp
- [coleslaw-models](http://npmjs.org/package/coleslaw-models) Builds CRUD models from your model definitions 
- [coleslaw-express](http://npmjs.org/package/coleslaw-express) Builds express routes from your model definitions
- [coleslaw-dynamo](http://npmjs.org/package/coleslaw-dynamo) Builds dynamo dataAccess layer from your model definitions
- [coleslaw-angular](http://npmjs.org/package/coleslaw-angular) Builds angular2 REST dataAccess layer from your model definitions
