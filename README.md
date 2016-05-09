# Coleslaw

Coleslaw is a Domain Specific Language (DSL) and related tools, for designing and creating Models.

## Installing
```bash
$ npm install coleslaw --save
```

## Usage
This library compiles coleslaw models into plain javascript. First create a file called `example.cls` with the following code:

```javascript
// example.cls
model Example {
    field name: string
}
```

Next compile your model into javascript using coleslaw:

```javascript
var fs = require('fs')
var path = require('path')
var coleslaw = require('coleslaw')

var clsPath = path.join(__dirname, 'example.cls')
 
fs.readFile(clsPath, 'utf8', (err, cls) => {
    coleslaw.compile(cls, (err, code) => {
        if (err) throw err
        // Do something with the generated code here...
    })
```

This will generate javascript that looks like this:

```
var Example = (function () {
    var fields = []
    var relationships = []
    var validations = []
    var authorizations = []
    var access = []
    fields.push({
        auto:  false,
        index: false,
        name: 'name',
        type: 'string',
    })
    return {
        type: 'model',
        name: 'Example',
        fields: fields,
        relationships: relationships,
        validations: validations,
        authorizations: authorizations,
        access: access
    }
})()
```

This code can be `eval`'d or saved to a file where it could then be `require`d instead. The object generated is called a `model definition`.

### Model Builders
Next, you can leverage various model builders which convert the model definitions into various tiers of your application.

- [gulp-coleslaw](http://npmjs.org/package/gulp-coleslaw) Compiles your model definitions with gulp
- [coleslaw-models](http://npmjs.org/package/coleslaw-models) Builds CRUD models from your model definitions 
- [coleslaw-express](http://npmjs.org/package/coleslaw-express) Builds express routes from your model definitions
- [coleslaw-dynamo](http://npmjs.org/package/coleslaw-dynamo) Builds dynamo dataAccess layer from your model definitions
- [coleslaw-angular](http://npmjs.org/package/coleslaw-angular) Builds angular2 REST dataAccess layer from your model definitions
- [more...](https://www.npmjs.com/search?q=coleslaw)