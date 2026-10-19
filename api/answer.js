import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `당신은 파로스(Pharos) ERP의 고객지원 담당자를 돕는 보조자입니다.
담당자가 받은 고객 문의와, 파로스 도움말 매뉴얼에서 찾아낸 발췌문이 함께 주어집니다.
담당자가 고객에게 그대로 보낼 수 있는 답변문을 작성하세요.

지켜야 할 것:
- 주어진 발췌문에 적혀 있는 내용만 근거로 쓰세요. 발췌문에 없는 화면·버튼·항목 이름을 만들어 내지 마세요.
- 발췌문으로 답할 수 없으면, 추측하지 말고 "현재 매뉴얼에서는 확인되지 않는 내용입니다"라고 쓴 뒤
  담당자가 무엇을 더 확인해야 하는지 한 줄로 알려 주세요.
- 고객에게 보내는 글이므로 정중한 존댓말로 쓰고, 사내 용어나 내부 사정은 넣지 마세요.
- 조작 순서가 있으면 1. 2. 3. 번호 목록으로 쓰세요. 메뉴 위치는 발췌문의 메뉴 경로를 그대로 "대분류 > 중분류 > 메뉴" 형식으로 적으세요.
- 길게 늘이지 말고, 문의에 대한 답과 필요한 순서만 담아 간결하게 쓰세요. 보통 10줄 안쪽입니다.
- 인사말로 시작하고 맺음말로 끝내되, 상투적인 미사여구는 쓰지 마세요.
- 출력은 답변문 본문만 쓰세요. "답변 초안:" 같은 머리말이나 해설을 붙이지 마세요.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 받습니다.' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({
      error: '답변 자동 작성이 설정되지 않았습니다. Vercel 환경변수 ANTHROPIC_API_KEY를 추가해 주세요.',
    });
    return;
  }

  const { question, sources } = req.body || {};
  if (!question || !Array.isArray(sources) || !sources.length) {
    res.status(400).json({ error: '문의 내용과 근거가 필요합니다.' });
    return;
  }

  const excerpts = sources
    .map((s, i) => {
      const label = s.kind === 'kb' ? '사내에 등록된 답변' : '도움말 매뉴얼';
      return `[발췌 ${i + 1} · ${label}]\n메뉴 경로: ${s.path}\n제목: ${s.title}\n본문:\n${s.text}`;
    })
    .join('\n\n---\n\n');

  const userText = `고객 문의:\n${question}\n\n찾아낸 발췌문:\n\n${excerpts}`;

  try {
    const client = new Anthropic();
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
    });

    if (message.stop_reason === 'refusal') {
      res.status(502).json({
        error: '모델이 이 요청에 답하지 않았습니다. 문의 내용을 줄여서 다시 시도해 주세요.',
      });
      return;
    }

    const draft = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!draft) {
      res.status(502).json({ error: '빈 답변이 돌아왔습니다. 다시 시도해 주세요.' });
      return;
    }

    res.status(200).json({ draft, model: message.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(502).json({ error: 'API 키가 올바르지 않습니다. Vercel 환경변수를 확인해 주세요.' });
      return;
    }
    if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: '요청이 몰렸습니다. 잠시 뒤 다시 시도해 주세요.' });
      return;
    }
    if (err instanceof Anthropic.APIConnectionError) {
      res.status(504).json({ error: 'Claude API에 연결하지 못했습니다.' });
      return;
    }
    console.error('answer failed', err);
    res.status(500).json({ error: '답변 작성 중 오류가 났습니다.' });
  }
}
