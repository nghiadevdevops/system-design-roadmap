// node tools/overview.js  → ghi 01-lo-trinh-24-tuan.md từ data/schedule.js + các file bài học
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const w = {}; const ctx = { window: w, console };
for (const f of ['schedule.js', 'phase1.js', 'phase2a.js', 'phase2a2.js', 'phase2b.js', 'cases1.js', 'cases2.js', 'knowledge.js', 'labs.js', 'tests.js', 'mocks_extra.js']) {
  const p = path.join(root, 'data', f); if (fs.existsSync(p)) { try { vm.runInNewContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (e) { console.error('skip', f, e.message); } }
}
const L = {}; [w.LESSONS_F, w.LESSONS_B1, w.LESSONS_B1B, w.LESSONS_B2, w.LESSONS_C1, w.LESSONS_C2, w.LESSONS_K].forEach(a => (a || []).forEach(l => L[l.id] = l));
const MOCKS = w.MOCKS || [], LABS = w.LABS || [], KT = w.KTESTS || [];
const PH = { 1: 'Giai đoạn 1 · Nền tảng (tuần 1–5)', 2: 'Giai đoạn 2 · Khối xây dựng (tuần 6–13)', 3: 'Giai đoạn 3 · Bài toán kinh điển (tuần 14–20)', 4: 'Giai đoạn 4 · Phỏng vấn & thực chiến (tuần 21–24)' };
const title = id => L[id] ? `**${id}** ${L[id].title}` : `**${id}**`;
let out = `# Lộ trình System Design 24 tuần\n\nBản in của lộ trình trong app \`index.html\` (mở app để học, làm quiz, mock, test). Mỗi tuần 8–12 giờ.\n\n## Nguyên tắc\n${w.PRINCIPLES.trim()}\n\n## Tổng quan\n${w.PHASE_OVERVIEW.trim()}\n`;
for (const ph of [1, 2, 3, 4]) {
  out += `\n## ${PH[ph]}\n`;
  const tpl = w.WEEKLY_TEMPLATE[ph];
  out += `\n**Lịch trong tuần (áp dụng cho mọi tuần của giai đoạn):**\n\n` + [1, 2, 3, 4, 5, 6].map(d => `- ${['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][d]}: ${(tpl[d] || []).join('; ')}`).join('\n') + '\n- Chủ nhật: nghỉ\n';
  for (const r of w.ROADMAP.filter(x => x.phase === ph)) {
    out += `\n### Tuần ${r.w}\n*${r.focus || ''}*\n\n`;
    out += (r.lessons || []).map(id => `- ${title(id)}${L[id] ? ` — ${L[id].goal}` : ''}`).join('\n') + '\n';
    (r.labs || []).forEach(id => { const l = LABS.find(x => x.id === id); if (l) out += `- Lab **${id}** ${l.title} (${l.time}) — ${l.goal}\n`; });
    (r.mocks || []).forEach(id => { const m = MOCKS.find(x => x.id === id); if (m) out += `- Mock **${id}** ${m.title}${r.cold ? ' — làm lạnh, không gợi ý' : ''}\n`; });
    if (r.ktest) { const t = KT.find(x => x.id === r.ktest); out += `- Test **${r.ktest}** ${t ? t.title + ` (${t.qs.length} câu, ${t.minutes} phút)` : ''}\n`; }
    if (r.milestone) out += `- **Mốc:** ${r.milestone}\n`;
  }
}
out += `\n## Đề mock lạ (Giai đoạn 4)\n` + MOCKS.filter(m => /^X/.test(m.id)).map(m => `- **${m.id}** ${m.title} (mức ${m.level})`).join('\n') + '\n';
out += `\n## Cách làm đề (tóm tắt)\n\nKhung 5 pha, 45 phút: làm rõ yêu cầu 5' → ước lượng 5' → thiết kế tổng thể 12' → đào sâu 18' → tổng kết 5'. Tự chấm 5 tiêu chí × 0–3:\n\n` + w.RUBRIC.map(r => `- **${r.name}**: 0 = ${r.d[0]}; 3 = ${r.d[3]}`).join('\n') + `\n\nChi tiết, bộ câu hỏi làm rõ, công thức ước lượng, prompt dùng AI làm người phỏng vấn: trong app → Hướng dẫn → Cách làm đề.\n`;
fs.writeFileSync(path.join(root, '01-lo-trinh-24-tuan.md'), out, 'utf8');
console.log('written 01-lo-trinh-24-tuan.md', out.length, 'chars; lessons known:', Object.keys(L).length);
