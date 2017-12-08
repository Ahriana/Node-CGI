const fs = require('fs');

let shebang = process.platform === 'win32' ?
  `#!"${process.execPath}"` :
  '#!/usr/bin/env node';

fs.writeFile('./index.js', `${shebang}"\nrequire('./base.js');`, (err) => {
  if (err)
    throw err;

  process.exit(0);
});
