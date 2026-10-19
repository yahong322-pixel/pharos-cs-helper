# 매뉴얼 데이터 다시 만들기

도움말이 개정되면 이 순서로 `data/manual.json` 을 새로 만들고 커밋합니다. Windows + Git Bash 기준이고, 전체 5~10분쯤 걸립니다.

```bash
cd tools
curl -s "https://help.upharos.com/api/help/menus?service=pharos" -o menus.json
powershell -File 1-flatten-menus.ps1    # 메뉴 트리를 평탄화 → menus_flat.json
powershell -File 1b-leaf-ids.ps1        # 실제 도움말 쪽만 추려 → leaf_ids.txt
bash 2-fetch-content.sh                 # 쪽별 본문 내려받기 → content/
powershell -File 3-build-index.ps1      # 정제 + 색인 → ../data/manual.json
```

마지막 단계가 `pages=…` 와 샘플 본문을 찍어 줍니다. **샘플에 한글이 제대로 보이는지 꼭 확인하세요.**

## 각 단계가 하는 일

| 파일 | 하는 일 |
|---|---|
| `1-flatten-menus.ps1` | 중첩된 메뉴 트리를 `전표관리 > 매출전표 > 세금계산서` 같은 경로 문자열이 붙은 평평한 목록으로 바꿉니다 |
| `1b-leaf-ids.ps1` | depth 2 이상, 즉 본문이 실제로 있는 쪽만 골라 냅니다 (현재 206개) |
| `2-fetch-content.sh` | `/api/help/content/{id}` 를 쪽마다 호출합니다 |
| `3-build-index.ps1` | 인라인 스타일·불필요한 속성을 떼고, 검색용 평문을 뽑고, 이미지 주소를 손봅니다 |

## 알아 둘 것

- **2단계는 반드시 `curl`** 로 받습니다. PowerShell의 `Invoke-WebRequest` 는 응답에 charset 이 없으면 본문을 ISO-8859-1 로 디코딩해서 한글이 전부 깨집니다.
- 3단계에서 이미지 주소를 손봅니다. 본문에 들어 있는 `stg.upharos.com` 링크(절반 가량)를 같은 경로가 살아 있는 `www.upharos.com` 으로 바꾸고, `/api/admin/images/...` 상대 주소는 `help.upharos.com` 절대 주소로 바꿉니다. 스테이징이 내려가도 캡처가 안 깨지게 하기 위한 것입니다.
- 비로그인으로 열리는 공개 API만 씁니다. 관리자 토큰은 필요 없습니다.
- `content/`, `menus*.json`, `leaf_ids.txt` 는 중간 산출물입니다. 커밋할 필요 없습니다.
