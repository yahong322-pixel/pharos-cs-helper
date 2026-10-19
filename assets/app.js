/* 파로스 CS 답변 도우미
 * 매뉴얼 206쪽 + 사용자 추가 지식에서 고객 문의에 맞는 근거를 찾아 답변 초안을 만든다.
 */

const HELP_URL = 'https://help.upharos.com/?service=pharos';

let PAGES = [];          // 매뉴얼: {id, title, path, html, text, lower}
let KB = [];             // 추가 지식: {id, q, a, menu, author, at}
let kbRemote = false;    // 공유 저장소 사용 여부
let lastSearch = null;   // 다시 생성용

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ───────────────────────── 기동 ───────────────────────── */

init();

async function init() {
  bindTabs();
  bindAsk();
  bindKb();
  bindBrowse();

  try {
    const res = await fetch('data/manual.json');
    if (!res.ok) throw new Error(res.status);
    const raw = await res.json();
    PAGES = raw.map((p) => ({ ...p, lower: p.text.toLowerCase() }));
  } catch {
    $('#corpusHint').textContent = '매뉴얼 데이터를 불러오지 못했습니다. 새로 고침해 주세요.';
    return;
  }

  fillMenuList();
  renderBrowse();
  await loadKb();
  updateCorpusHint();
}

function updateCorpusHint() {
  const store = kbRemote ? '팀 공유' : '이 브라우저에만 저장';
  $('#corpusHint').textContent =
    `매뉴얼 ${PAGES.length}쪽 · 추가 지식 ${KB.length}건 (${store})`;
  $('#kbCount').textContent = String(KB.length);
}

/* ───────────────────────── 탭 ───────────────────────── */

function bindTabs() {
  $$('.tab').forEach((btn) => {
    btn.addEventListener('click', () => show(btn.dataset.view));
  });
  $$('[data-goto-kb]').forEach((b) =>
    b.addEventListener('click', () => {
      show('kb');
      openKbForm();
    })
  );
}

function show(view) {
  $$('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.view === view));
  ['ask', 'kb', 'browse'].forEach((v) => {
    $(`#view-${v}`).hidden = v !== view;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ───────────────────── 검색 엔진 ───────────────────── */

/** 조사·어미를 모르는 상태에서 쓸 수 있는 어간 추정:
 *  뒤에서 최대 3글자까지 잘라 보고, 말뭉치에 실제로 나타나는 가장 긴 형태를 쓴다. */
function normalizeTerm(token, corpus) {
  for (let cut = 0; cut <= 3; cut++) {
    const cand = token.slice(0, token.length - cut);
    if (cand.length < 2) break;
    if (corpus.includes(cand)) return cand;
  }
  return token.length >= 2 ? token : null;
}

function tokenize(query, corpus) {
  const cleaned = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const seen = new Set();
  const terms = [];
  for (const raw of cleaned.split(' ')) {
    if (raw.length < 2) continue;
    const term = normalizeTerm(raw, corpus);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

function countOf(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function search(query) {
  // 말뭉치 전체를 한 덩어리로 두고 어간 추정에 쓴다.
  const corpus = searchCorpus();
  const terms = tokenize(query, corpus);
  if (!terms.length) return { terms: [], hits: [] };

  const docs = buildDocs();
  const N = docs.length || 1;

  // 코퍼스에서 직접 구한 IDF — 흔한 말(조회·저장)은 자동으로 가벼워진다.
  const idf = {};
  for (const t of terms) {
    let df = 0;
    for (const d of docs) if (d.lower.includes(t)) df++;
    idf[t] = Math.log((N + 1) / (df + 0.5));
  }
  const idfTotal = terms.reduce((s, t) => s + idf[t], 0) || 1;
  const strong = terms.filter((t) => idf[t] > 0.5);

  const phrase = query.toLowerCase().replace(/\s+/g, ' ').trim();

  const hits = [];
  for (const d of docs) {
    let score = 0;
    const matched = [];

    for (const t of terms) {
      const inText = countOf(d.lower, t);
      const inTitle = countOf(d.titleLower, t);
      const inPath = countOf(d.pathLower, t);
      if (!inText && !inTitle && !inPath) continue;
      matched.push(t);
      score += idf[t] * (inTitle * 8 + inPath * 4 + Math.min(inText, 6));
    }
    if (!matched.length) continue;

    // 질문의 여러 낱말이 한 문서에 모여 있을 때 크게 올려 준다.
    const need = strong.length ? strong : terms;
    const covered = need.filter((t) => matched.includes(t)).length / need.length;
    score += covered * covered * idfTotal * 3;

    if (phrase.length > 5 && d.lower.includes(phrase)) score += idfTotal * 2;
    score *= d.boost;

    hits.push({ doc: d, score, matched });
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, 8);
  const cut = top.length ? top[0].score * 0.12 : 0;
  return { terms, hits: top.filter((h) => h.score >= cut) };
}

function searchCorpus() {
  if (!searchCorpus._cache || searchCorpus._n !== PAGES.length + KB.length) {
    searchCorpus._cache = [
      ...PAGES.map((p) => p.lower + ' ' + p.path.toLowerCase()),
      ...KB.map((k) => (k.q + ' ' + k.a).toLowerCase()),
    ].join('\n');
    searchCorpus._n = PAGES.length + KB.length;
  }
  return searchCorpus._cache;
}

function buildDocs() {
  const manual = PAGES.map((p) => ({
    kind: 'manual',
    id: 'm' + p.id,
    title: p.title,
    path: p.path,
    text: p.text,
    html: p.html,
    lower: p.lower,
    titleLower: p.title.toLowerCase(),
    pathLower: p.path.toLowerCase(),
    boost: 1,
  }));
  const kb = KB.map((k) => ({
    kind: 'kb',
    id: 'k' + k.id,
    title: k.q,
    path: k.menu ? `추가 지식 · ${k.menu}` : '추가 지식',
    text: k.a,
    html: null,
    lower: (k.q + ' ' + k.a).toLowerCase(),
    titleLower: k.q.toLowerCase(),
    pathLower: (k.menu || '').toLowerCase(),
    boost: 1.4,
    meta: k,
  }));
  return [...kb, ...manual];
}

/* ───────────────────── 답변 찾기 화면 ───────────────────── */

function bindAsk() {
  $('#askForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runAsk($('#q').value.trim());
  });
  $('#regenBtn').addEventListener('click', () => {
    if (lastSearch) makeDraft(lastSearch.question, lastSearch.hits, true);
  });
  $('#copyBtn').addEventListener('click', copyDraft);
}

function runAsk(question) {
  if (!question) {
    $('#q').focus();
    return;
  }
  if (!PAGES.length) return;

  const { terms, hits } = search(question);
  lastSearch = { question, terms, hits };

  $('#askResult').hidden = false;
  renderHits(hits, terms);

  $('#hitCount').textContent = hits.length ? `${hits.length}건` : '';
  $('#noHits').hidden = hits.length > 0;
  $('#draftCard').hidden = hits.length === 0;

  if (hits.length) makeDraft(question, hits, false);
}

function renderHits(hits, terms) {
  const box = $('#hits');
  box.textContent = '';

  hits.forEach((hit, i) => {
    const d = hit.doc;
    const card = document.createElement('article');
    card.className = 'hit';

    const top = document.createElement('div');
    top.className = 'hit-top';
    top.setAttribute('role', 'button');
    top.tabIndex = 0;

    const left = document.createElement('div');
    const path = document.createElement('p');
    path.className = 'hit-path';
    path.textContent = d.path;
    const title = document.createElement('p');
    title.className = 'hit-title';
    title.textContent = d.title;
    left.append(path, title);

    const meta = document.createElement('div');
    meta.className = 'hit-meta';
    if (d.kind === 'kb') {
      const b = document.createElement('span');
      b.className = 'badge badge-kb';
      b.textContent = '추가 지식';
      meta.append(b);
    } else if (i === 0) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = '가장 가까움';
      meta.append(b);
    }
    const caret = document.createElement('span');
    caret.textContent = '본문 보기';
    meta.append(caret);

    top.append(left, meta);

    const excerpt = document.createElement('p');
    excerpt.className = 'hit-excerpt';
    excerpt.append(...highlight(makeExcerpt(d.text, hit.matched), hit.matched));

    const full = document.createElement('div');
    full.className = 'hit-full';
    full.hidden = true;

    top.addEventListener('click', () => {
      if (full.hidden && !full.dataset.filled) {
        full.dataset.filled = '1';
        const doc = document.createElement('div');
        doc.className = 'doc';
        if (d.html) {
          doc.innerHTML = d.html;
          doc.querySelectorAll('img').forEach((img) => {
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
          });
        } else {
          const p = document.createElement('p');
          p.style.whiteSpace = 'pre-wrap';
          p.textContent = d.text;
          doc.append(p);
        }
        const foot = document.createElement('div');
        foot.className = 'hit-foot';
        if (d.kind === 'manual') {
          const a = document.createElement('a');
          a.href = HELP_URL;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = '도움말 사이트 열기';
          const hintEl = document.createElement('span');
          hintEl.className = 'hint';
          hintEl.textContent = `메뉴 경로: ${d.path}`;
          foot.append(a, hintEl);
        }
        full.append(doc, foot);
      }
      full.hidden = !full.hidden;
      caret.textContent = full.hidden ? '본문 보기' : '접기';
    });
    top.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        top.click();
      }
    });

    card.append(top, excerpt, full);
    box.append(card);
  });
}

/** 가장 정보량 높은 낱말이 나오는 자리를 중심으로 발췌 */
function makeExcerpt(text, terms, width = 240) {
  let at = -1;
  const lower = text.toLowerCase();
  for (const t of [...terms].sort((a, b) => b.length - a.length)) {
    const i = lower.indexOf(t);
    if (i >= 0) {
      at = i;
      break;
    }
  }
  if (at < 0) return text.slice(0, width).trim() + (text.length > width ? '…' : '');

  let start = Math.max(0, at - Math.floor(width / 3));
  const nl = text.lastIndexOf('\n', at);
  if (nl > start - 60 && nl >= 0 && nl < at) start = nl + 1;

  const slice = text.slice(start, start + width).replace(/\n+/g, ' ').trim();
  return (start > 0 ? '…' : '') + slice + (start + width < text.length ? '…' : '');
}

function highlight(text, terms) {
  const sorted = [...terms].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!sorted.length) return [document.createTextNode(text)];

  const rx = new RegExp(
    '(' + sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'gi'
  );
  const out = [];
  let last = 0;
  for (const m of text.matchAll(rx)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    out.push(mark);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/* ───────────────────── 답변 초안 ───────────────────── */

async function makeDraft(question, hits, isRetry) {
  const body = $('#draftBody');
  const note = $('#draftNote');
  $('#copyBtn').disabled = true;
  $('#regenBtn').disabled = true;
  body.className = 'draft-body is-loading';
  body.textContent = '';
  const spin = document.createElement('span');
  spin.className = 'spin';
  body.append(spin, document.createTextNode(isRetry ? '다시 쓰고 있습니다…' : '매뉴얼을 읽고 답변을 작성하고 있습니다…'));
  note.textContent = '';

  const sources = hits.slice(0, 3).map((h) => ({
    kind: h.doc.kind,
    title: h.doc.title,
    path: h.doc.path,
    text: h.doc.text.slice(0, 4000),
  }));

  let draft = null;
  let generated = false;
  try {
    const res = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, sources }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.draft) {
      draft = data.draft;
      generated = true;
    } else if (data.error) {
      note.textContent = data.error;
    }
  } catch {
    /* 네트워크 실패 → 아래 템플릿으로 */
  }

  if (!draft) draft = templateDraft(question, hits);

  body.className = 'draft-body';
  body.textContent = draft;
  $('#copyBtn').disabled = false;
  $('#regenBtn').disabled = !generated;

  const used = hits.slice(0, 3).map((h) => h.doc.path).join(' / ');
  note.textContent = generated
    ? `참고한 근거: ${used} — 보내기 전에 한 번 읽어 봐 주세요.`
    : [note.textContent, `자동 작성이 꺼져 있어 매뉴얼 본문을 그대로 모아 두었습니다. 참고: ${used}`]
        .filter(Boolean)
        .join(' ');
}

/** 답변 생성 API를 못 쓸 때, 매뉴얼 본문을 그대로 모아 주는 대체 초안 */
function templateDraft(question, hits) {
  const best = hits[0].doc;
  const lines = best.text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .slice(0, 6);

  const out = [
    '안녕하세요. 문의하신 내용 안내드립니다.',
    '',
    ...lines,
    '',
    `· 해당 메뉴: ${best.path}`,
  ];
  if (hits[1]) out.push(`· 함께 볼 메뉴: ${hits[1].doc.path}`);
  out.push('', '추가로 궁금한 점 있으시면 말씀해 주세요. 감사합니다.');
  return out.join('\n');
}

async function copyDraft() {
  const text = $('#draftBody').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했습니다');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('복사했습니다');
  }
}

/* ───────────────────── 추가 지식 ───────────────────── */

function bindKb() {
  $('#kbNewBtn').addEventListener('click', () => openKbForm());
  $('#kbCancelBtn').addEventListener('click', closeKbForm);
  $('#kbForm').addEventListener('submit', saveKb);
}

async function loadKb() {
  try {
    const res = await fetch('/api/kb');
    const data = await res.json();
    if (res.ok && data.configured) {
      kbRemote = true;
      KB = data.items || [];
    } else {
      KB = localKb();
    }
  } catch {
    KB = localKb();
  }
  searchCorpus._cache = null;
  renderKb();
  updateCorpusHint();
  $('#kbStatus').textContent = kbRemote
    ? '팀 공유 저장소에 저장됩니다. 링크를 받은 사람 모두가 같은 내용을 봅니다.'
    : '공유 저장소가 아직 연결되지 않아 이 브라우저에만 저장됩니다.';
}

function localKb() {
  try {
    return JSON.parse(localStorage.getItem('pharos-kb') || '[]');
  } catch {
    return [];
  }
}

function saveLocalKb() {
  try {
    localStorage.setItem('pharos-kb', JSON.stringify(KB));
  } catch {
    /* 사생활 보호 모드 등 — 저장 못 해도 화면은 그대로 쓴다 */
  }
}

function openKbForm(entry) {
  const form = $('#kbForm');
  form.hidden = false;
  $('#kbId').value = entry?.id || '';
  $('#kbQ').value = entry?.q || '';
  $('#kbA').value = entry?.a || '';
  $('#kbMenu').value = entry?.menu || '';
  $('#kbAuthor').value = entry?.author || localStorage.getItem('pharos-author') || '';
  $('#kbQ').focus();
}

function closeKbForm() {
  $('#kbForm').hidden = true;
  $('#kbForm').reset();
  $('#kbId').value = '';
}

async function saveKb(e) {
  e.preventDefault();
  const q = $('#kbQ').value.trim();
  const a = $('#kbA').value.trim();
  if (!q || !a) {
    toast('질문과 답변을 모두 채워 주세요');
    return;
  }
  const entry = {
    id: $('#kbId').value || 'k' + Date.now().toString(36),
    q,
    a,
    menu: $('#kbMenu').value.trim(),
    author: $('#kbAuthor').value.trim(),
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem('pharos-author', entry.author);
  } catch { /* 무시 */ }

  $('#kbSaveBtn').disabled = true;
  if (kbRemote) {
    try {
      const res = await fetch('/api/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      $('#kbSaveBtn').disabled = false;
      toast('저장에 실패했습니다');
      return;
    }
  }
  $('#kbSaveBtn').disabled = false;

  const i = KB.findIndex((k) => k.id === entry.id);
  if (i >= 0) KB[i] = entry;
  else KB.unshift(entry);
  if (!kbRemote) saveLocalKb();

  searchCorpus._cache = null;
  closeKbForm();
  renderKb();
  updateCorpusHint();
  toast('저장했습니다');
}

async function removeKb(entry) {
  if (!confirm(`"${entry.q}" 항목을 지울까요?`)) return;
  if (kbRemote) {
    try {
      const res = await fetch('/api/kb?id=' + encodeURIComponent(entry.id), { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      toast('삭제에 실패했습니다');
      return;
    }
  }
  KB = KB.filter((k) => k.id !== entry.id);
  if (!kbRemote) saveLocalKb();
  searchCorpus._cache = null;
  renderKb();
  updateCorpusHint();
}

function renderKb() {
  const list = $('#kbList');
  list.textContent = '';
  $('#kbEmpty').hidden = KB.length > 0;

  const sorted = [...KB].sort((x, y) => (y.at || '').localeCompare(x.at || ''));
  for (const k of sorted) {
    const el = document.createElement('article');
    el.className = 'kbitem';

    const h = document.createElement('h3');
    h.textContent = k.q;
    const a = document.createElement('p');
    a.className = 'kbans';
    a.textContent = k.a;

    const foot = document.createElement('div');
    foot.className = 'kbitem-foot';
    if (k.menu) {
      const m = document.createElement('span');
      m.className = 'kbmenu';
      m.textContent = k.menu;
      foot.append(m);
    }
    const who = document.createElement('span');
    who.textContent = [k.author || '작성자 미기재', fmtDate(k.at)].filter(Boolean).join(' · ');
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const edit = document.createElement('button');
    edit.className = 'linkbtn';
    edit.type = 'button';
    edit.textContent = '수정';
    edit.addEventListener('click', () => openKbForm(k));
    const del = document.createElement('button');
    del.className = 'linkbtn';
    del.type = 'button';
    del.textContent = '삭제';
    del.addEventListener('click', () => removeKb(k));

    foot.append(who, spacer, edit, del);
    el.append(h, a, foot);
    list.append(el);
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ───────────────────── 매뉴얼 전체 ───────────────────── */

function bindBrowse() {
  $('#browseFilter').addEventListener('input', renderBrowse);
}

function fillMenuList() {
  const dl = $('#menuList');
  dl.textContent = '';
  for (const p of PAGES) {
    const o = document.createElement('option');
    o.value = p.path;
    dl.append(o);
  }
}

function renderBrowse() {
  const q = ($('#browseFilter')?.value || '').trim().toLowerCase();
  const box = $('#browseList');
  box.textContent = '';

  const groups = new Map();
  for (const p of PAGES) {
    if (q && !p.path.toLowerCase().includes(q)) continue;
    const top = p.path.split(' > ')[0];
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(p);
  }

  for (const [top, items] of groups) {
    const g = document.createElement('section');
    g.className = 'browse-group';
    const h = document.createElement('h3');
    h.textContent = `${top} (${items.length})`;
    const ul = document.createElement('ul');
    for (const p of items) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = p.path.split(' > ').slice(1).join(' > ') || p.title;
      a.title = p.path;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        show('ask');
        $('#q').value = p.title;
        runAsk(p.title);
      });
      li.append(a);
      ul.append(li);
    }
    g.append(h, ul);
    box.append(g);
  }

  if (!groups.size) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = '해당하는 메뉴가 없습니다.';
    box.append(p);
  }
}

/* ───────────────────── 공통 ───────────────────── */

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 1800);
}
