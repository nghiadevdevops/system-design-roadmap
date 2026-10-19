// node tools/validate.js data/<file>.js [data/<file2>.js ...]
// Loads each data file with a stub window and checks the shared schema.
const fs = require('fs'), path = require('path'), vm = require('vm');
let bad = 0;
const err = (f, m) => { bad++; console.log('  ✗ ' + f + ': ' + m); };
const TOPICS = new Set(['net','os','db','cache','queue','api','scale','consistency','storage','security','observability','go','concurrency','cloud','design','behavioral','realtime','search','data']);
const TYPES = new Set(['foundation','block','case','knowledge']);
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const w = {}; const ctx = { window: w, console };
  try { vm.runInNewContext(src, ctx, { filename: file }); } catch (e) { err(file, 'SyntaxError/runtime: ' + e.message); continue; }
  if (/\$\{/.test(src)) err(file, 'contains "${" inside source (template interpolation not allowed in content)');
  const keys = Object.keys(w);
  console.log(file + ' → window.' + keys.join(', window.'));
  const checkMd = (where, md) => {
    if (typeof md !== 'string') return;
    const fences = (md.match(/^~~~/mg) || []).length; if (fences % 2) err(where, 'unbalanced ~~~ code fence');
    const dg = (md.match(/^:::/mg) || []).length; if (dg % 2) err(where, 'unbalanced ::: diagram block');
    md.split('\n').forEach((l, i) => { if (/^\s*```/.test(l)) err(where, 'line ' + (i + 1) + ' uses ``` (use ~~~)'); });
    // diagram lines must be "A -> B" or "A -> B : label" or "A[Label]"
    let inD = false; md.split('\n').forEach((l, i) => { if (/^:::diagram/.test(l)) { inD = true; return; } if (/^:::\s*$/.test(l)) { inD = false; return; } if (inD && l.trim() && !/^\s*[\w.-]+(\[[^\]]*\])?\s*(->|--)\s*[\w.-]+(\[[^\]]*\])?\s*(:.*)?$/.test(l) && !/^\s*[\w.-]+\[[^\]]*\]\s*$/.test(l)) err(where, 'diagram line ' + (i + 1) + ' invalid: ' + l.trim()); });
  };
  const checkQuiz = (where, quiz) => {
    if (!Array.isArray(quiz)) { err(where, 'quiz missing'); return; }
    quiz.forEach((q, i) => {
      const t = q.t || 'mc'; const wq = where + ' quiz#' + (i + 1);
      if (!q.q) err(wq, 'no q');
      if (t === 'mc') { if (!Array.isArray(q.o) || q.o.length < 3) err(wq, 'mc needs >=3 options'); if (typeof q.a !== 'number' || q.a < 0 || q.a >= (q.o || []).length) err(wq, 'mc a index invalid'); }
      else if (t === 'fill') { if (!Array.isArray(q.a) || !q.a.length) err(wq, 'fill a must be non-empty array'); if (!/___/.test(q.q)) err(wq, 'fill q should contain ___'); }
      else if (t === 'open') { if (typeof q.a !== 'string' || q.a.length < 20) err(wq, 'open a must be model answer string'); if (!Array.isArray(q.keys) || q.keys.length < 2) err(wq, 'open keys must list >=2 keywords'); }
      else err(wq, 'unknown t ' + t);
      if (!q.why && t !== 'open') err(wq, 'missing why');
    });
  };
  for (const k of keys) {
    const v = w[k];
    if (/^LESSONS_/.test(k)) {
      if (!Array.isArray(v)) { err(k, 'not array'); continue; }
      const ids = new Set();
      v.forEach(l => {
        const where = k + '/' + (l.id || '?');
        ['id','type','title','goal','md','apply','quiz','time'].forEach(f => { if (l[f] == null) err(where, 'missing ' + f); });
        if (ids.has(l.id)) err(where, 'duplicate id'); ids.add(l.id);
        if (!TYPES.has(l.type)) err(where, 'bad type ' + l.type);
        if (l.topic && !TOPICS.has(l.topic)) err(where, 'bad topic ' + l.topic);
        const lines = (l.md || '').split('\n').length; if (lines < 40) err(where, 'md too short (' + lines + ' lines)');
        if (l.type === 'case' && !/:::diagram/.test(l.md || '')) err(where, 'case lesson needs a :::diagram block');
        checkMd(where + ' md', l.md); checkMd(where + ' apply', l.apply); checkQuiz(where, l.quiz);
        if ((l.quiz || []).length < 6) err(where, 'quiz has < 6 questions');
      });
      console.log('  ' + k + ': ' + v.length + ' lessons OK-ish');
    }
    if (k === 'MOCKS') {
      v.forEach(m => { const where = 'MOCKS/' + (m.id || '?');
        ['id','title','prompt','level','clarify','phases','followups','rubric_notes'].forEach(f => { if (m[f] == null) err(where, 'missing ' + f); });
        ['req','est','hld','deep','wrap'].forEach(p => { const ph = (m.phases || {})[p]; if (!ph) { err(where, 'phase ' + p + ' missing'); return; } if (!Array.isArray(ph.checks) || ph.checks.length < 3) err(where, p + '.checks needs >=3'); if (!ph.hint) err(where, p + '.hint missing'); checkMd(where + ' ' + p, ph.hint); });
        if (!m.caseId && !m.reference) err(where, 'needs caseId or reference md'); checkMd(where + ' reference', m.reference); checkMd(where + ' rubric_notes', m.rubric_notes);
      }); console.log('  MOCKS: ' + v.length);
    }
    if (k === 'KTESTS') { v.forEach(t => { const where = 'KTESTS/' + t.id; if (!t.minutes) err(where, 'minutes'); (t.qs || []).forEach((q, i) => { if (!TOPICS.has(q.topic)) err(where + '#' + (i + 1), 'bad topic ' + q.topic); }); checkQuiz(where, t.qs); if ((t.qs || []).length < 25) err(where, 'needs >=25 questions'); }); console.log('  KTESTS: ' + v.length); }
    if (k === 'ORAL') { v.forEach((q, i) => { const where = 'ORAL#' + (i + 1); if (!q.id || !q.q || !q.a || !q.topic) err(where, 'missing id/q/a/topic'); if (!TOPICS.has(q.topic)) err(where, 'bad topic ' + q.topic); checkMd(where, q.a); }); console.log('  ORAL: ' + v.length); }
    if (k === 'FLASH') { let n = 0; v.forEach(d => { const where = 'FLASH/' + d.id; if (!d.title || !d.kind) err(where, 'title/kind'); (d.cards || []).forEach((c, i) => { n++; if (!c.f || !c.b) err(where + '#' + (i + 1), 'f/b'); }); }); console.log('  FLASH: ' + v.length + ' decks, ' + n + ' cards'); }
    if (k === 'LABS') { v.forEach(l => { const where = 'LABS/' + l.id; ['id','title','goal','stack','steps','accept','observe','time'].forEach(f => { if (l[f] == null) err(where, 'missing ' + f); }); checkMd(where, l.observe); (l.steps || []).forEach(s => checkMd(where + ' step', s)); }); console.log('  LABS: ' + v.length); }
  }
}
console.log(bad ? ('\n' + bad + ' problem(s)') : '\nAll good');
process.exit(bad ? 1 : 0);
