model example {
    access allow 'Pugs Rule' get x
}

example.access[0].role.should.equal('Pugs Rule')