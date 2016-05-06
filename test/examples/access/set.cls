model example {
    access allow * set x
}

example.access[0].mode.should.equal('set')