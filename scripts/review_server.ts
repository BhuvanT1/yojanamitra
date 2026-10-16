/**
 * Stage 2b — the clause review tool.
 *
 * A deliberate departure from the folder plan, stated plainly: this is a
 * single-user internal tool, not the citizen-facing app. It is a dependency-free
 * Node HTTP server serving one page, so `npm run review` works immediately with
 * no framework install, no build step and no API key. The Next.js app in
 * src/app/ remains the citizen surface, where i18n, SSR and mobile actually
 * matter. Bolting the reviewer onto that would have made the bottleneck tool the
 * slowest thing to start.
 *
 * Review is GROUP-first: identical clause text across schemes is one decision.
 * The queue is ordered by group size, so the largest wins come first.
 *
 * Usage:  npm run review     → http://localhost:5174
 */

import { createServer } from 'node:http';
import { AnnotationStore, StaleRevisionError, InvalidConstraintError } from '../src/storage/annotation_store';
import type { Clause, ClauseKind } from '../src/domain/clause';

const PORT = Number(process.env.PORT ?? 5174);
const REVIEWER = process.env.REVIEWER ?? 'reviewer';

const store = new AnnotationStore();

interface QueueItem {
  group_id: string;
  size: number;
  representative: Clause;
  scheme_ids: string[];
}

/** Groups still awaiting a decision, largest first. */
function queue(): QueueItem[] {
  const groups = new Map<string, Clause[]>();
  for (const c of store.all()) {
    if (c.annotation_state !== 'proposed') continue;
    const g = c.dedup_group_id ?? c.id;
    const list = groups.get(g) ?? [];
    list.push(c);
    groups.set(g, list);
  }
  return [...groups.entries()]
    .map(([group_id, cs]) => ({
      group_id,
      size: cs.length,
      representative: cs[0]!,
      scheme_ids: [...new Set(cs.map((c) => c.scheme_id))].slice(0, 12),
    }))
    .sort((a, b) => b.size - a.size || a.group_id.localeCompare(b.group_id));
}

function json(res: import('node:http').ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/queue') {
      const limit = Number(url.searchParams.get('limit') ?? 30);
      json(res, 200, { items: queue().slice(0, limit), stats: store.stats() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') {
      json(res, 200, store.stats());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      const action = String(body.action);
      const groupId = body.group_id ? String(body.group_id) : undefined;
      const clauseId = body.clause_id ? String(body.clause_id) : undefined;
      const revision = Number(body.revision);

      if (action === 'approve_group' && groupId) {
        const result = store.approveGroup(groupId, REVIEWER);
        store.save();
        json(res, 200, { ok: true, approved: result.approved.length, skipped: result.skipped });
        return;
      }

      if (!clauseId) {
        json(res, 400, { error: 'clause_id required' });
        return;
      }

      let out: Clause;
      switch (action) {
        case 'approve':
          out = store.approve(clauseId, revision, REVIEWER, groupId);
          break;
        case 'reject':
          out = store.reject(clauseId, revision, REVIEWER, String(body.reason ?? 'not machine-checkable'));
          break;
        case 'reclassify':
          out = store.reclassify(clauseId, revision, String(body.kind) as ClauseKind, REVIEWER);
          break;
        case 'edit':
          out = store.edit(
            clauseId,
            revision,
            (body.constraint ?? null) as Clause['constraint'],
            REVIEWER,
            body.note ? String(body.note) : undefined,
          );
          break;
        default:
          json(res, 400, { error: `unknown action ${action}` });
          return;
      }
      store.save();
      json(res, 200, { ok: true, clause: out });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    if (err instanceof StaleRevisionError) {
      json(res, 409, { error: err.message, kind: 'stale_revision' });
      return;
    }
    if (err instanceof InvalidConstraintError) {
      json(res, 422, { error: err.message, problems: err.problems });
      return;
    }
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  const s = store.stats();
  console.log(`\nYojanaMitra clause review  →  http://localhost:${PORT}`);
  console.log(`reviewer: ${REVIEWER}   (set REVIEWER=yourname to change)`);
  console.log(`${s.by_state.proposed} clauses awaiting review in ${queue().length} groups`);
  console.log(`${s.decisive} decisive clauses so far\n`);
});

// ---------------------------------------------------------------- the page

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Clause review</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--fg:#e6e9ef;--dim:#8b93a3;
        --ok:#3fb950;--warn:#d29922;--bad:#f85149;--acc:#58a6ff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  header{display:flex;gap:18px;align-items:baseline;padding:12px 20px;
         border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
  header h1{font-size:15px;margin:0;font-weight:650;letter-spacing:-.2px}
  .stat{color:var(--dim);font-size:12.5px}
  .stat b{color:var(--fg);font-variant-numeric:tabular-nums}
  main{max-width:960px;margin:0 auto;padding:22px 20px 120px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:16px}
  .groupbar{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  .pill{font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);color:var(--dim)}
  .pill.big{background:rgba(88,166,255,.14);border-color:rgba(88,166,255,.5);color:#9ecbff;font-weight:600}
  .prose{font-size:16px;line-height:1.6;background:#0b0d12;border:1px solid var(--line);
         border-radius:8px;padding:14px 16px;white-space:pre-wrap}
  h3{font-size:11.5px;text-transform:uppercase;letter-spacing:.9px;color:var(--dim);
     margin:18px 0 7px;font-weight:600}
  pre{background:#0b0d12;border:1px solid var(--line);border-radius:8px;padding:12px 14px;
      overflow:auto;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
  textarea{width:100%;min-height:160px;background:#0b0d12;color:var(--fg);border:1px solid var(--line);
           border-radius:8px;padding:12px 14px;font:12.5px/1.5 ui-monospace,Menlo,monospace}
  .note{border-left:3px solid var(--warn);background:rgba(210,153,34,.09);padding:9px 13px;
        border-radius:0 6px 6px 0;font-size:13px;color:#e8d9b0;margin-top:12px}
  .gap{border-left-color:var(--acc);background:rgba(88,166,255,.09);color:#bcd9fb}
  .schemes{font-size:12px;color:var(--dim);margin-top:10px;word-break:break-all}
  footer{position:fixed;left:0;right:0;bottom:0;background:var(--panel);
         border-top:1px solid var(--line);padding:11px 20px;display:flex;gap:8px;
         flex-wrap:wrap;justify-content:center}
  button{background:#21262d;color:var(--fg);border:1px solid var(--line);border-radius:7px;
         padding:8px 13px;font-size:13px;cursor:pointer;font-family:inherit}
  button:hover{border-color:var(--acc)}
  button kbd{background:#0b0d12;border:1px solid var(--line);border-radius:4px;
             padding:0 5px;margin-right:7px;font-size:11px;color:var(--dim)}
  button.ok{border-color:rgba(63,185,80,.5)} button.bad{border-color:rgba(248,81,73,.45)}
  .empty{text-align:center;color:var(--dim);padding:70px 20px}
  .flash{position:fixed;top:60px;left:50%;transform:translateX(-50%);padding:9px 16px;
         border-radius:8px;font-size:13px;z-index:10;border:1px solid var(--line);background:var(--panel)}
  .flash.err{border-color:var(--bad);color:#ffb3ae}
  .flash.good{border-color:var(--ok);color:#8ce99a}
</style></head>
<body>
<header>
  <h1>Clause review</h1>
  <span class="stat">queue <b id="s-queue">–</b> groups</span>
  <span class="stat">approved <b id="s-approved">–</b></span>
  <span class="stat">decisive <b id="s-decisive">–</b></span>
  <span class="stat">this session <b id="s-session">0</b></span>
</header>
<main id="app"><div class="empty">loading…</div></main>
<footer id="bar"></footer>
<script>
let items=[], idx=0, session=0, editing=false;

const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

async function load(){
  const r = await fetch('/api/queue?limit=60');
  const d = await r.json();
  items = d.items; idx = 0;
  paint(d.stats);
}

function flash(msg, cls){
  const el = document.createElement('div');
  el.className = 'flash ' + (cls||'');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2600);
}

function paint(stats){
  if(stats){
    document.getElementById('s-approved').textContent = stats.by_state.approved;
    document.getElementById('s-decisive').textContent = stats.decisive;
  }
  document.getElementById('s-queue').textContent = items.length - idx;
  document.getElementById('s-session').textContent = session;

  const app = document.getElementById('app');
  const bar = document.getElementById('bar');
  const it = items[idx];

  if(!it){
    app.innerHTML = '<div class="empty">Queue empty for this batch.<br><br>' +
      '<button onclick="load()">Fetch more</button></div>';
    bar.innerHTML = '';
    return;
  }

  const c = it.representative;
  const gap = c.annotation_state === 'needs_schema_extension';

  app.innerHTML =
    '<div class="card">' +
      '<div class="groupbar">' +
        (it.size > 1
          ? '<span class="pill big">' + it.size + ' clauses — one decision covers all</span>'
          : '<span class="pill">single clause</span>') +
        '<span class="pill">' + esc(c.kind) + '</span>' +
        '<span class="pill">' + esc(c.annotation_state) + '</span>' +
        '<span class="pill">rev ' + c.revision + '</span>' +
      '</div>' +
      '<h3>Source text</h3>' +
      '<div class="prose">' + esc(c.source_text) + '</div>' +
      (c.review_reason
        ? '<div class="note' + (gap?' gap':'') + '">' + esc(c.review_reason) + '</div>'
        : '') +
      '<h3>Proposed constraint</h3>' +
      (editing
        ? '<textarea id="ed">' + esc(JSON.stringify(c.constraint, null, 2)) + '</textarea>'
        : '<pre>' + esc(c.constraint ? JSON.stringify(c.constraint, null, 2) : 'none — nothing proposed') + '</pre>') +
      '<div class="schemes">' + esc(c.source_url) + '<br>schemes: ' + it.scheme_ids.join(', ') +
        (it.size > it.scheme_ids.length ? ' …' : '') + '</div>' +
    '</div>';

  bar.innerHTML = editing
    ? '<button class="ok" onclick="saveEdit()"><kbd>ctrl+↵</kbd>Save edit</button>' +
      '<button onclick="editing=false;paint()"><kbd>esc</kbd>Cancel</button>'
    : (c.constraint ? '<button class="ok" onclick="act(\\'approve\\')"><kbd>a</kbd>Approve' +
        (it.size>1 ? ' all ' + it.size : '') + '</button>' : '') +
      '<button onclick="editing=true;paint()"><kbd>e</kbd>Edit</button>' +
      '<button class="bad" onclick="act(\\'reject\\')"><kbd>r</kbd>Not checkable</button>' +
      '<button onclick="reclass(\\'procedural\\')"><kbd>p</kbd>Procedural</button>' +
      '<button onclick="reclass(\\'informational\\')"><kbd>i</kbd>Informational</button>' +
      '<button onclick="skip()"><kbd>s</kbd>Skip</button>';
}

function skip(){ idx++; editing=false; paint(); }

async function post(body){
  const r = await fetch('/api/action', {
    method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)
  });
  const d = await r.json();
  if(!r.ok){
    flash(d.error || 'failed', 'err');
    if(d.kind === 'stale_revision') load();
    return null;
  }
  return d;
}

async function act(action){
  const it = items[idx]; if(!it) return;
  const c = it.representative;
  let d;
  if(action === 'approve' && it.size > 1){
    d = await post({action:'approve_group', group_id: it.group_id});
    if(d) flash('approved ' + d.approved + ' clauses', 'good');
  } else {
    d = await post({action, clause_id: c.id, revision: c.revision, group_id: it.group_id,
                    reason: action==='reject' ? 'marked not machine-checkable in review' : undefined});
    if(d) flash(action === 'approve' ? 'approved' : 'recorded', 'good');
  }
  if(!d) return;
  session += (d.approved ?? 1);
  idx++; editing=false;
  const st = await (await fetch('/api/stats')).json();
  paint(st);
}

async function reclass(kind){
  const it = items[idx]; if(!it) return;
  const c = it.representative;
  const d = await post({action:'reclassify', clause_id:c.id, revision:c.revision, kind});
  if(!d) return;
  flash('marked ' + kind, 'good');
  session++; idx++; editing=false;
  paint(await (await fetch('/api/stats')).json());
}

async function saveEdit(){
  const it = items[idx]; if(!it) return;
  const c = it.representative;
  let parsed;
  try { parsed = JSON.parse(document.getElementById('ed').value); }
  catch(e){ flash('not valid JSON: ' + e.message, 'err'); return; }
  const d = await post({action:'edit', clause_id:c.id, revision:c.revision, constraint:parsed});
  if(!d) return;
  it.representative = d.clause;
  editing = false;
  flash('edit saved — approval revoked, approve again to confirm', 'good');
  paint();
}

document.addEventListener('keydown', e => {
  if(editing){
    if(e.key === 'Escape'){ editing=false; paint(); }
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
    return;
  }
  if(e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if(k === 'a') act('approve');
  if(k === 'e'){ editing = true; paint(); }
  if(k === 'r') act('reject');
  if(k === 'p') reclass('procedural');
  if(k === 'i') reclass('informational');
  if(k === 's') skip();
});

load();
</script>
</body></html>`;
