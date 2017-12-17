const util = require('util');
const fs = require('fs');
const querystring = require('querystring');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { _builtinLibs: builtinLibs } = require('repl');

const readFile = (...args) => util.promisify(fs.readFile)(...args).then((s) => s.toString());


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
    status: 200,
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

if (+safeGlobals.request.headers['content-length'] === 0)
  finish();
else
  process.stdin.on('end', finish);

let RES_500 = [
  'Status: 500 Internal Server Error',
  '', '',
].join('\r\n');

async function finish() {
  try {
    var source = await readFile(process.env.PATH_TRANSLATED);
  } catch (err) {
    stderr(err);
    return process.stdout.write(RES_500);
  }

  parse(source);
}

let responseHeadWritten = false;
function out(x) {
  if (!x)
    return;

  if (!responseHeadWritten) {
    responseHeadWritten = true;
    const response = safeGlobals.response;
    const status = response.status;
    process.stdout.write([
      `Status: ${status} ${http.STATUS_CODES[status] || ''}`.trim(),
      ...Object.keys(response.headers).map((k) => `${k}: ${response.headers[k]}`),
      '',
    ].join('\r\n'));
  }

  process.stdout.write(x);
}

function parse(source, context) {
  let buffer = '';
  let inJs = false;

  for (let i = 0; i < source.length; i++) {
    const current = source[i];
    if (current === '<' && source[i + 1] === '?') {
      // entering js
      out(buffer);
      buffer = '';
      inJs = true;
      i++;
    } else if (current === '?' && source[i + 1] === '>') {
      if (!inJs) {
        buffer += current;
        continue;
      }

      const exitEarly = !runScript(buffer, context);

      buffer = '';
      inJs = false;
      i++;

      if (exitEarly)
        break;
    } else {
      buffer += current;
    }
  }

  if (inJs && buffer !== '') {
    // no trailing "?>"
    runScript(buffer, context);
  } else {
    out(buffer);
  }
}

const RELATIVE_DIR = path.dirname(process.env.PATH_TRANSLATED);
function scopedRequire(name) {
  if (builtinLibs.includes(name))
    return require(name);
  return require(path.resolve(RELATIVE_DIR, name));
}

const kExitEarly = Symbol('exit early');
function runScript(source, context) {
  const script = new vm.Script(source);
  if (context === undefined) {
    context = vm.createContext({
      global: contextGlobal,
      ...contextGlobal,
      process,
      require: scopedRequire,
      write: out,
      exit: () => {
        const e = new Error();
        e[kExitEarly] = true;
        throw e;
      },
      include: (name) => {
        const s = fs.readFileSync(path.join(RELATIVE_DIR, name)).toString();
        parse(s, context);
      },
    });
  }

  try {
    script.runInContext(context);
  } catch (err) {
    if (err[kExitEarly])
      return false;
    else
      stderr(err);
  }

  return true;
}
