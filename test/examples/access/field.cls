model example {
    access allow * get x
}

example.access[0].field.should.equal('x')