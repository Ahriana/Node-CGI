const fs = require('fs');

const template = `<html lang=en>
<head>
<style>
table.table {
  table-layout:fixed;
  width: 100% !important;
  background-color: #ffffff;
  border-collapse: collapse;
  border-width: 2px;
  border-color: #1c5e1e;
  border-style: solid;
  color: #000000;
}
table.table td, table.table th {
  border-width: 2px;
  border-color: #1c5e1e;
  border-style: solid;
  padding: 3px;
}
table.table thead {
  background-color: #3ec147;
}
.container {
  margin: auto;
  width: 80%;
  border: 3px solid green;
  padding: 10px;
  word-wrap: break-word;
  max-width: 70%;
}
.pic {
  max-width:100%;
}
</style>
</head>
<body>
<div class=container>
<img src="LOGO" class=pic alt=NodeCGI>
TABLES
</body>
</html>`;

function table(title, scope) {
  let str = `<table class="table"> <thead> <tr> <th>${title}</th> </tr> </thead> <tbody>`;
  for (var v in scope) {
    if (scope.hasOwnProperty(v))
      str += `<tr><td>${v}</td><td>${scope[v]}</td></tr>`;
  }
  return `${str}</tbody></table>`;
}

function nodeinfo() {
  const logo = fs.readFileSync('./logo.png');
  const tables = [
    table('Versions', process.versions),
    table('Features', process.features),
    table('Environment', process.env),
  ];
  return template
    .replace('LOGO', `data:image/png;base64,${logo.toString('base64')}`)
    .replace('TABLES', tables.join(''));
}

module.exports = nodeinfo;
