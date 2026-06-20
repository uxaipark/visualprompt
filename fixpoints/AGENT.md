# 에이전트 작업 지침 (fixpoints inbox)

이 디렉토리는 **VisualPrompt** 가 수집한 "수정 포인트(fixpoint)" 의 inbox 입니다.

## 구조
- `pending/` — 아직 처리되지 않은 fixpoint. `fp-NNN.json` (구조화 데이터) + `fp-NNN.md` (사람/에이전트용 요약).
- `applied/` — 처리 완료해 옮겨진 fixpoint.

## 처리 절차
1. `pending/` 의 각 `fp-NNN.md` 를 읽는다.
2. "수정 지시" 와 "소스코드에서 찾을 단서"(검색어/추정 파일)를 사용해 레포에서 대상 소스를 찾는다.
   - 프론트엔드 검색어: `data-testid=...`, `.class`, `#id`, `component:...` 로 grep.
   - `target.repoRoot` 가 있으면 그 레포 안에서 찾는다 (local 모드).
3. 지시대로 소스를 수정한다. 타깃 요소만 정확히 고치고 무관한 코드는 건드리지 않는다.
4. 처리한 fixpoint 파일(`.json`, `.md`)을 `applied/` 로 옮긴다.

## json 스키마 핵심 필드
- `prompt`     — 사용자가 작성한 수정 지시
- `element`    — { tag, id, selector, xpath, rect, text, classes }
- `clues`      — { framework, testids, components, ids, labels, classes, bundles, api }
- `sourceHints`— { frontend: [...], backend: [...] }
- `fileHints`  — 추정 파일 glob/grep 후보
- `target`     — { mode: 'local'|'proxy', url, repoRoot }
