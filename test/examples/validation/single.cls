model Example {
    field name: string
}

assert(new Example().name.rules.validation[0] === 'string')