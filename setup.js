const fs = require('fs');

let shebang = process.platform === 'win32' ?
  `#!"${process.execPath}"` :
  '#!/usr/bin/env node';

fs.writeFileSync('./index.js', `${shebang}\nrequire('./base.js');`);
fs.chmodSync('./index.js', '755');

process.exit(0);
