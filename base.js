const util = require('util');
const fs = require('fs');
const querystring = require('querystring');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
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
      name = name.toLowerCase();
      if (name === 'set-cookie') {
        if (this.headers['set-cookie'] === undefined)
          this.headers['set-cookie'] = [];
        this.headers['set-cookie'].push(value);
      } else {
        this.headers[name] = value;
      }
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    status: 200,
  },
  server: {},
  session: undefined,
  global: {},
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
    const headers = safeGlobals.request.headers;
    if (name === 'cookie') {
      if (!headers.cookie)
        headers.cookie = [];
      const sets = process.env[key].split(';');
      for (const set of sets) {
        if (/^node_cgi_session/.test(set))
          safeGlobals.session = require('./session').get(set.split('=')[1]);
        else
          headers.cookie.push(set);
      }
    } else {
      headers[name] = process.env[key];
    }
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

  process.stdout.write('\r\n\r\n');
}

let responseHeadWritten = false;
function out(x) {
  if (!x)
    return;

  if (!responseHeadWritten) {
    responseHeadWritten = true;
    const response = safeGlobals.response;
    const status = response.status;
    const headers = [];
    for (const name of Object.keys(response.headers)) {
      if (name === 'set-cookie') {
        for (const val of response.headers['set-cookie']) {
          headers.push(`Set-Cookie: ${val}`);
          if (/^node_cgi_session/.test(val))
            require('./session').set(val.split('=')[1], safeGlobals.session);
        }
      } else {
        headers.push(`${name}: ${response.headers[name]}`);
      }
    }
    process.stdout.write([
      `Status: ${status} ${http.STATUS_CODES[status] || ''}`.trim(),
      ...headers,
      '', '',
    ].join('\r\n'));
  }

  process.stdout.write(String(x));
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
      get global() {
        return safeGlobals.global;
      },
      get request() {
        return safeGlobals.request;
      },
      get response() {
        return safeGlobals.response;
      },
      get server() {
        return safeGlobals.server;
      },
      get session() {
        if (safeGlobals.session === undefined) {
          safeGlobals.session = {};
          const key = crypto.createHash('sha256').update(new Date().toString()).digest('hex');
          safeGlobals.response.setHeader('Set-Cookie', `node_cgi_session=${key}`);
        }
        return safeGlobals.session;
      },
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
