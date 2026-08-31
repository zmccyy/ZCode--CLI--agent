const assert = require('node:assert')
const { shout, repeat } = require('./string.js')

assert.equal(shout('hello'), 'HELLO', 'shout should uppercase')
assert.equal(repeat('ab', 3), 'ababab', 'repeat should repeat')
console.log('string tests passed')
