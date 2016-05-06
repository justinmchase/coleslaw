model example {
    access allow * get x
}

example.access[0].mode.should.equal('get')