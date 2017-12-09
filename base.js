const fs = require('fs');
const vm = require('vm');
const querystring = require('querystring');
const http = require('http');
const path = require('path');
const util = require('util');
const { _builtinLibs: builtinLibs } = require('repl');
const nodeinfo = require('./nodeinfo');
const displayErrors = false;

// eslint-disable-next-line no-console
const stderr = (...x) => console.error(...x);

const safeGlobals = {
  request: {
    headers: {},
    body: '',
    method: 'GET',
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
  },
  response: {
    headers: {
      'content-type': 'text/html',
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
  },
  server: {},
};

process.stdin.on('data', (chunk) => {
  safeGlobals.request.body += chunk;
});

for (const key of Object.keys(process.env)) {
  if (/^HTTP_/.test(key)) {
    const name = key.slice(5)
      .toLowerCase()
      .split('_')
      .join('-');
    safeGlobals.request.headers[name] = process.env[key];
  } else if (/^REQUEST_/.test(key)) {
    safeGlobals.request[key.slice(8).toLowerCase()] = process.env[key];
  } else if (/^SERVER_/.test(key)) {
    safeGlobals.server[key.slice(7).toLowerCase()] = process.env[key];
  } else if (key === 'QUERY_STRING') {
    safeGlobals.request.queryString = process.env.QUERY_STRING;
    safeGlobals.request.query = querystring.parse(process.env.QUERY_STRING);
  }
}

if (+safeGlobals.request.headers['content-length'] === 0)
  finish();
else
  process.stdin.on('end', finish);

const contextGlobal = {
  get request() {
    return safeGlobals.request;
  },
  get response() {
    return safeGlobals.response;
  },
  get server() {
    return safeGlobals.server;
  },
};

const RELATIVE_DIR = path.dirname(process.env.PATH_TRANSLATED);
function scopedRequire(name) {
  if (builtinLibs.includes(name))
    return require(name);
  return require(path.resolve(RELATIVE_DIR, name));
}

let RES_500 = [
  'Status: 500 Internal Server Error',
  'Content-Length: 0',
  '', '',
].join('\r\n');
const readFile = (...args) => util.promisify(fs.readFile)(...args).then((s) => s.toString());
async function finish() {
  try {
    var source = await readFile(process.env.PATH_TRANSLATED);
  } catch (err) {
    stderr(err);
    return process.stdout.write(displayErrors ? RES_500 + err.stack: RES_500);
  }

  let output = '';
  let buffer = '';
  let inJs = false;
  for (let i = 0; i < source.length; i++) {
    const current = source[i];
    const next = source[i + 1];
    if (current === '<' && next === '?') {
      output += buffer;
      buffer = '';
      inJs = true;
      i++;
    } else if (current === '?' && next === '>') {
      if (!inJs) {
        buffer += current;
        continue;
      }
      try {
        const script = new vm.Script(buffer);
        script.runInNewContext({
          global: contextGlobal,
          ...contextGlobal,
          require: scopedRequire,
          write: (x) => { output += x; },
          process,
          nodeinfo: () => { output += nodeinfo(); },
        });
      } catch (err) {
        stderr(err);
        return process.stdout.write(displayErrors ? RES_500 + err.stack : RES_500);
      }
      inJs = false;
      buffer = '';
      i++;
    } else {
      buffer += current;
    }
  }
  output += buffer;

  const response = safeGlobals.response;
  const status = response.status || 200;
  process.stdout.write([
    `Status: ${status} ${http.STATUS_CODES[status] || ''}`.trim(),
    `Content-Length: ${Buffer.byteLength(output)}`,
    ...Object.keys(response.headers).map((k) => `${k}: ${response.headers[k]}`),
    '', '',
  ].join('\r\n'));
  process.stdout.write(output);
  process.stdout.write('\r\n\r\n');
}
