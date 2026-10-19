/* 추가 지식 저장소.
 * Upstash Redis(REST)가 연결돼 있으면 팀 전체가 같은 내용을 보고,
 * 없으면 configured:false 를 돌려주어 브라우저 저장으로 되돌아간다.
 */

const HASH = 'pharos:kb';

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(command) {
  const s = store();
  const res = await fetch(s.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${s.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`redis ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function clean(entry) {
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const id = text(entry.id, 64).replace(/[^\w-]/g, '');
  const q = text(entry.q, 400);
  const a = text(entry.a, 8000);
  if (!id || !q || !a) return null;
  return {
    id,
    q,
    a,
    menu: text(entry.menu, 200),
    author: text(entry.author, 60),
    at: text(entry.at, 40) || new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (!store()) {
    res.status(200).json({
      configured: false,
      items: [],
      hint: '공유 저장소가 없습니다. Vercel에서 Upstash Redis를 연결하면 팀 전체가 같은 내용을 봅니다.',
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', HASH])) || [];
      const items = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          items.push(JSON.parse(flat[i]));
        } catch {
          /* 깨진 항목은 건너뛴다 */
        }
      }
      items.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
      res.status(200).json({ configured: true, items });
      return;
    }

    if (req.method === 'POST') {
      const entry = clean(req.body || {});
      if (!entry) {
        res.status(400).json({ error: '질문과 답변이 필요합니다.' });
        return;
      }
      await redis(['HSET', HASH, entry.id, JSON.stringify(entry)]);
      res.status(200).json({ ok: true, item: entry });
      return;
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').replace(/[^\w-]/g, '');
      if (!id) {
        res.status(400).json({ error: 'id가 필요합니다.' });
        return;
      }
      await redis(['HDEL', HASH, id]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'GET, POST, DELETE만 받습니다.' });
  } catch (err) {
    console.error('kb failed', err);
    res.status(500).json({ error: '저장소에 접근하지 못했습니다.' });
  }
}
