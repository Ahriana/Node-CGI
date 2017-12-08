const shebang = `#!"${process.execPath}"`;
const fileIn = 'index.js';
const fileOut = 'Node-CGI.js';
const fs = require('fs');

let data = fs.readFileSync(`./${fileIn}`).toString().split('\n');
data.splice(0, 0, shebang);
data = data.join('\n');

fs.writeFile(`./${fileOut}`, data, (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log('all done!');
    }
});
