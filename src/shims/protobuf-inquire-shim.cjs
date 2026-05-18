const { Buffer } = require('buffer');

let Long = null;
try {
  Long = require('long');
} catch {
  Long = null;
}

function inquire(moduleName) {
  switch (moduleName) {
    case 'buffer':
      return { Buffer };
    case 'long':
      return Long;
    default:
      return null;
  }
}

module.exports = inquire;
