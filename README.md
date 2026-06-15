# 독고탁 스튜디오 1.0

제품 이미지와 PDF를 한국어 판매 쇼츠 대본, 자막, Typecast 나레이션,
썸네일 문구, 장면별 영상 구성으로 바꾸는 AI 콘텐츠 제작 스튜디오 사이트입니다.

## Quick Start

```bash
npm install
npm run dev
npm run build
```

Windows 로컬 실행은 `npm run dev` 또는 `start-dokgotak-studio.bat`을
사용합니다. 이 시작 경로는 Wrangler 로그와 로컬 API 키 저장 위치를
프로젝트 안의 `.dokgotak-local` 폴더로 고정합니다.

## Project Shape

- `app/page.tsx`: 독고탁 스튜디오 랜딩 페이지
- `app/layout.tsx`: 사이트 메타데이터와 한국어 문서 설정
- `app/globals.css`: 전역 스타일과 한글 시스템 폰트 설정
- `public/dokgotak-studio-hero.png`: 생성형 히어로 배경 이미지
- `.openai/hosting.json`: Sites 배포용 리소스 선언

## Build

```bash
npm run build
```
