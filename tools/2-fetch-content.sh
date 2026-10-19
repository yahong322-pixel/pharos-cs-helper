#!/usr/bin/env bash
# 메뉴별 본문을 내려받는다.
#
# PowerShell의 Invoke-WebRequest 는 응답 Content-Type 에 charset 이 없으면
# 본문을 ISO-8859-1 로 디코딩해서 한글이 깨진다. 그래서 이 단계만 curl 로 받는다.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p content

n=0
while read -r id; do
  id="${id%$'\r'}"
  [ -z "$id" ] && continue
  curl -s -m 30 "https://help.upharos.com/api/help/content/$id" -o "content/$id.json"
  n=$((n + 1))
done < leaf_ids.txt

echo "fetched=$n files=$(ls content | wc -l)"
