# 파로스 CS 답변 도우미

고객 문의를 붙여넣으면 파로스 도움말 매뉴얼에서 근거를 찾아 주고, 고객에게 바로 보낼 수 있는 답변 초안까지 만들어 주는 사내 도구입니다.

## 무엇이 들어 있나

- **매뉴얼 206쪽 전문** — `help.upharos.com` 공개 API에서 받아 본문·캡처 링크를 정제한 `data/manual.json`
- **검색** — 브라우저에서 바로 도는 한국어 검색. 조사·어미를 잘라 어간을 추정하고, 말뭉치에서 직접 구한 IDF로 흔한 말(조회·저장 등)의 비중을 자동으로 낮춥니다
- **답변 초안** — 찾아낸 발췌문만 근거로 Claude가 작성 (`api/answer.js`)
- **추가 지식** — 매뉴얼에 없는 안내 기준을 직접 등록·수정·삭제 (`api/kb.js`)

빌드 과정이 없는 정적 사이트 + Vercel 서버리스 함수 두 개입니다.

## 배포

### 1. GitHub

```bash
git remote add origin https://github.com/<계정>/pharos-cs-helper.git
git push -u origin main
```

### 2. Vercel

[vercel.com/new](https://vercel.com/new) 에서 이 저장소를 Import 합니다. 프레임워크는 **Other**, 빌드 명령·출력 디렉터리는 비워 둡니다.

이대로 배포하면 **매뉴얼 검색은 바로 동작**합니다. 답변 자동 작성과 팀 공유는 아래를 켜야 합니다.

### 3. 답변 자동 작성 켜기

Vercel 프로젝트 → Settings → Environment Variables 에 추가:

| 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) 에서 발급한 API 키 |

추가한 뒤 Deployments에서 **Redeploy** 해야 반영됩니다. 키가 없으면 사이트는 매뉴얼 본문을 그대로 모아 둔 대체 초안을 보여 줍니다.

### 4. 추가 지식 팀 공유 켜기

Vercel 프로젝트 → Storage → **Upstash for Redis** 를 만들어 이 프로젝트에 연결합니다. `KV_REST_API_URL` / `KV_REST_API_TOKEN` 환경변수가 자동으로 들어오고, 그다음 Redeploy 하면 추가 지식이 팀 전체에 공유됩니다.

연결 전까지는 추가한 내용이 **그 브라우저에만** 저장됩니다. 화면 위쪽에 어느 쪽인지 표시됩니다.

## 매뉴얼 갱신

도움말이 개정되면 `data/manual.json` 을 다시 만들어 커밋하면 됩니다. 만드는 절차는 [`tools/README.md`](tools/README.md) 에 적어 두었습니다.

## 주의

- 답변 초안은 **사람이 검토한 뒤** 보내세요. 발췌문 밖의 내용을 쓰지 않도록 지시해 두었지만, 매뉴얼 자체가 낡아 있을 수 있습니다.
- 본문 캡처는 `www.upharos.com` 의 이미지를 그대로 불러옵니다. 서비스 쪽에서 이미지를 치우면 깨집니다.
