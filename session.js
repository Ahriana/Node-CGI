const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'node_cgi');

module.exports = {
  get(name) {
    try {
      return require(path.join(tmp, name));
    } catch (err) {
      return {};
    }
  },
  set(name, value) {
    try {
      fs.writeFileSync(path.join(tmp, name), JSON.stringify(value));
    } catch (err) {
      return false;
    }
    return true;
  },
  tmp,
};
