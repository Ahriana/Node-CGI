const fs = require('fs');
const vm = require('vm');
const querystring = require('querystring');
const http = require('http');
const path = require('path');
const util = require('util');
const { _builtinLibs: builtinLibs } = require('repl');
const nodeinfo = require('./nodeinfo');

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

function runScript(src, output = true, context) {
  const out = output ? (x) => process.stdout.write(x) : () => true;
  const script = new vm.Script(src);
  if (context === undefined) {
    context = vm.createContext({
      global: contextGlobal,
      ...contextGlobal,
      require: scopedRequire,
      write: (x) => { out(x); },
      process,
      nodeinfo: () => { out(nodeinfo()); },
      exit: () => {
        const e = new Error();
        e.EXIT_EARLY = true;
        throw e;
      },
      include: (name) => {
        const s = fs.readFileSync(path.join(RELATIVE_DIR, name)).toString();
        parse(s, 0, context);
      },
    });
  }
  try {
    script.runInContext(context);
  } catch (err) {
    if (err.EXIT_EARLY)
      return false;
    else
      stderr(err);
  }

  return true;
}

let RES_500 = [
  'Status: 500 Internal Server Error',
  '', '',
].join('\r\n');
const readFile = (...args) => util.promisify(fs.readFile)(...args).then((s) => s.toString());
async function finish() {
  try {
    var source = await readFile(process.env.PATH_TRANSLATED);
  } catch (err) {
    stderr(err);
    return process.stdout.write(RES_500);
  }

  let startOffset = 0;
  if (source[0] === '<' && source[1] === '?') {
    let code = '';
    for (let i = 2; i < source.length; i++) {
      if (source[i] === '?' && source[i + 1] === '>')
        break;
      code += source[i];
      startOffset = i + 1;
    }
    if (!runScript(code, false))
      startOffset = source.length;
  }

  const response = safeGlobals.response;
  const status = response.status || 200;
  process.stdout.write([
    `Status: ${status} ${http.STATUS_CODES[status] || ''}`.trim(),
    ...Object.keys(response.headers).map((k) => `${k}: ${response.headers[k]}`),
    '', '',
  ].join('\r\n'));

  parse(source, startOffset);

  process.stdout.write('\r\n\r\n');
}

function parse(source, startOffset = 0, context) {
  let buffer = '';
  let inJs = false;
  for (let i = startOffset; i < source.length; i++) {
    const current = source[i];
    const next = source[i + 1];
    if (current === '<' && next === '?') {
      process.stdout.write(buffer);
      buffer = '';
      inJs = true;
      i++;
    } else if (current === '?' && next === '>') {
      if (!inJs) {
        buffer += current;
        continue;
      }
      if (!runScript(buffer, true, context))
        break;
      inJs = false;
      buffer = '';
      i++;
    } else {
      buffer += current;
    }
  }
  if (inJs) {
    // no trailing "?>" in script, but its ok
    runScript(buffer, true, context);
  } else if (buffer) {
    process.stdout.write(buffer);
  }
}
