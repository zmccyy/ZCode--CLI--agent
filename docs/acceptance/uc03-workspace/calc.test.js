const assert = require('node:assert')
const { add, multiply } = require('./calc.js')

assert.equal(add(2, 3), 5, 'add should sum')
assert.equal(add(-1, 1), 0, 'add should handle negatives')
assert.equal(multiply(3, 4), 12, 'multiply should work')
console.log('calc tests passed')
