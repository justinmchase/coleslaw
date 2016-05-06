model example {
    access allow * get foo
}

example.access[0].type.should.equal('allow')