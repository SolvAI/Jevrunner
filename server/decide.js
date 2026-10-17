// The game's only server code, as a Vite plugin: the page POSTs each decision here and this forwards it to the
// decision model's System One endpoint (the browser can't call it directly: no CORS), times it, and logs it.
//   POST /api/decide   {requests: [{state, questions}], meta}  ->  {model, answers, latencyMs, modelMs}
//   POST /api/outcome  {run, row, outcome, ...}  ->  logged next to the decision
//   GET  /api/health                              ->  {up, url, label}
// Every line goes to runs/decisions-<date>.jsonl.
// Environment: DECIDE_URL picks the System One endpoint (default: H2O Lightning 4B's shim on this machine);
// DECIDE_KEY is sent as a bearer token and DECIDE_MODEL as the request's "model", for hosted endpoints (the key stays
// on this server, never reaches the page); MODEL_LABEL is the name the panel shows (default "H2O").
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:8741/v1/systemone';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(obj));
}

export function decidePlugin({
  url = process.env.DECIDE_URL || DEFAULT_URL,
  key = process.env.DECIDE_KEY || '',
  model = process.env.DECIDE_MODEL || '',
  label = process.env.MODEL_LABEL || 'H2O',
  runsDir = join(process.cwd(), 'runs'),
  timeoutMs = 5000,
} = {}) {
  const logFile = () => join(runsDir, `decisions-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.jsonl`);
  const log = async (line) => {
    try {
      await mkdir(runsDir, { recursive: true });
      await appendFile(logFile(), `${JSON.stringify(line)}\n`);
    } catch (err) {
      console.error('[jevrunner] log failed:', err.message);
    }
  };
  const base = url.replace(/\/v1\/systemone\/?$/, '');
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
  const headers = { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };

  return {
    name: 'jevrunner-decide',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (path === '/api/health' && req.method === 'GET') {
          if (!local) return send(res, 200, { up: true, remote: true, url, label }); // hosted APIs have no /health
          try {
            const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
            return send(res, 200, { up: r.ok, url, label });
          } catch {
            return send(res, 200, { up: false, url, label });
          }
        }
        if (path === '/api/outcome' && req.method === 'POST') {
          try {
            await log({ type: 'outcome', t: Date.now() / 1000, ...JSON.parse(await readBody(req)) });
          } catch {
            // a malformed outcome is not worth an error on the page
          }
          return send(res, 200, { ok: true });
        }
        if (path !== '/api/decide' || req.method !== 'POST') return next();
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: 'expected JSON' });
        }
        // {requests: [{state, questions}, ...]} goes out in parallel (one lane question, one move question per lane)
        const { meta = {} } = body;
        const requests = Array.isArray(body.requests) ? body.requests : [{ state: body.state, questions: body.questions }];
        const t0 = performance.now();
        try {
          const outs = await Promise.all(requests.map(async ({ state, questions }) => {
            const r = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(model ? { model, state, questions } : { state, questions }),
              signal: AbortSignal.timeout(timeoutMs),
            });
            const text = await r.text();
            if (!r.ok) throw new Error(`model answered HTTP ${r.status}: ${text.slice(0, 200)}`);
            return JSON.parse(text);
          }));
          const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
          const answers = Object.assign({}, ...outs.map((o) => o.answers));
          const modelMs = Math.max(...outs.map((o) => o.usage?.latency_ms ?? 0)) || null;
          const inputTokens = outs.reduce((a, o) => a + (o.usage?.input_tokens ?? 0), 0);
          // the log keeps the text state and the answers; an image is noted, not stored
          const state = requests[0].state?.screen ? { ...requests[0].state, screen: '[image]' } : requests[0].state;
          await log({ type: 'decision', t: Date.now() / 1000, ...meta, status: 200, latencyMs, modelMs, inputTokens, state, answers });
          return send(res, 200, { model: outs[0].model ?? 'decision model', answers, latencyMs, modelMs, inputTokens });
        } catch (err) {
          const latencyMs = Math.round(performance.now() - t0);
          await log({ type: 'decision', t: Date.now() / 1000, ...meta, status: 502, error: err.message, latencyMs });
          return send(res, 502, { error: `${err.message} (${url})`, latencyMs });
        }
      });
    },
  };
}
