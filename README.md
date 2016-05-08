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

coleslaw.compile(fs.readFileSync(path.join(__dirname, 'example.cls'), 'utf8'), (err, code) => {
    if (err) throw err
    eval(code)
})
```

The resulting code is a plain javascript object representing the model described. This model can be used by various coleslaw builders.

### Build your model definitions into Models
The default model builder can be used to generate Model instances from model defintions. Model instances have standard CRUD (create, retrieve, update, delete) functionality.

```javascript
model Example {
    field value: string
}

var ExampleModel = coleslaw.build(Example, options) // Example is the model definition
var instance = new ExampleModel({ value: 'test' })  // from an existing object
instance.set('value', 'success')                    // update a field value
instance.save()                                     // Calls dataAccess.update()
```

In this case we are using the `coleslaw.build` example to create a Model type from the Example model definition. Next we can create an instance of ExampleModel and do basic CRUD operations. The model keeps track of the state of the object.

## Model features
- fields
- relationships
- validation rules
- authorization rules
- access rules

## Model Builders
- [coleslaw-express](http://npmjs.org/package/coleslaw-express)
- [coleslaw-dynamo](http://npmjs.org/package/coleslaw-dynamo)
- [coleslaw-angular](http://npmjs.org/package/coleslaw-angular)
