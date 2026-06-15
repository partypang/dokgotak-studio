export type ManualStoryboardRow = {
  time: string;
  visual: string;
  caption: string;
  narration: string;
};

export function cleanManualScriptLine(line: string) {
  const quoted = line.match(/[“"]([^”"]{4,})[”"]/);
  const source = quoted?.[1] ?? line;

  return source
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[\).\s-]+/, "")
    .replace(/^[“"']+|[”"']+$/g, "")
    .trim();
}

function isManualScriptSectionStart(line: string) {
  return /^(실제\s*쇼츠\s*대본|완성\s*대본|사용자\s*입력\s*대본)/.test(line);
}

function isManualScriptSectionEnd(line: string) {
  return /^(장면별\s*화면\s*지시|영상 톤|자막 스타일|영상 스타일 디렉션|촬영 컷 리스트|마지막 엔딩|마지막 화면|전체 콘셉트|30초 구성안|활용 요소|감성형|광고형|강한 쇼츠형|좀 더)/.test(
    line,
  );
}

function isManualScriptMetaLine(line: string) {
  return /^(주제|쇼츠 제목|제목 후보|또는|30초 구성|시간\s*화면|장면별 화면 지시|사용자 입력 대본|실제 쇼츠 대본|완성 대본|전체 콘셉트|분위기|색감|음악|영상 톤|자막 스타일|큰 자막|마지막 화면|영상 스타일 디렉션|촬영 컷 리스트|마지막 엔딩|배경음악|화면 색감|활용 요소|감성형|광고형|강한 쇼츠형|좀 더)/.test(
    line,
  );
}

export function splitManualScriptLines(script: string) {
  const lines = script
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const completeIndex = lines.findIndex(isManualScriptSectionStart);

  if (completeIndex !== -1) {
    const selected: string[] = [];
    let currentBlock: string[] = [];
    const pushCurrentBlock = () => {
      if (currentBlock.length > 0) {
        selected.push(currentBlock.join(" "));
        currentBlock = [];
      }
    };

    for (const line of lines.slice(completeIndex + 1)) {
      if (isManualScriptSectionEnd(line)) {
        break;
      }

      if (/^\d+\s*초$/.test(line)) {
        pushCurrentBlock();
        continue;
      }

      const cleaned = cleanManualScriptLine(line);
      if (cleaned.length >= 6) {
        currentBlock.push(cleaned);
      }
    }

    pushCurrentBlock();

    if (selected.length > 0) {
      return selected;
    }
  }

  const storyboardNarrations = extractManualStoryboardRows(script)
    .map((row) => cleanManualScriptLine(row.narration))
    .filter((line) => line.length >= 6);

  if (storyboardNarrations.length > 0) {
    return storyboardNarrations;
  }

  return lines
    .map(cleanManualScriptLine)
    .filter((line) => line.length >= 6 && !isManualScriptMetaLine(line));
}

export function extractNumberedSectionLines(
  script: string,
  sectionPattern: RegExp,
  stopPattern: RegExp,
) {
  const lines = script
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const startIndex = lines.findIndex((line) => sectionPattern.test(line));

  if (startIndex === -1) {
    return [];
  }

  const collected: string[] = [];

  for (const line of lines.slice(startIndex + 1)) {
    if (stopPattern.test(line)) {
      break;
    }

    const cleaned = line
      .replace(/^[-*]\s*/, "")
      .replace(/^\d+[\).\s-]+/, "")
      .trim();

    if (cleaned.length >= 4) {
      collected.push(cleaned);
    }
  }

  return collected;
}

export function extractManualStoryboardRows(script: string): ManualStoryboardRow[] {
  return script
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\s*~\s*\d+초/.test(line))
    .map((line) => {
      const columns = line
        .split(/\t+/)
        .map((column) => column.trim())
        .filter(Boolean);

      if (columns.length >= 4) {
        return {
          time: columns[0],
          visual: columns[1],
          caption: columns[2],
          narration: cleanManualScriptLine(columns.slice(3).join(" ")),
        };
      }

      const time = line.match(/^(\d+\s*~\s*\d+초)/)?.[1] ?? "";
      const rest = line.replace(/^\d+\s*~\s*\d+초\s*/, "").trim();
      const narration =
        rest.match(/[“"]([^”"]{2,})[”"]/)?.[1] ?? "";
      const beforeNarration = narration
        ? rest.slice(0, rest.indexOf(narration)).replace(/[“"]+$/g, "")
        : rest;

      return {
        time,
        visual: beforeNarration.trim(),
        caption: "",
        narration: cleanManualScriptLine(narration),
      };
    })
    .filter((row) => row.visual || row.caption || row.narration);
}

export function extractManualSceneVisuals(script: string) {
  const storyboardVisuals = extractManualStoryboardRows(script)
    .map((row) => row.visual)
    .filter(Boolean);

  if (storyboardVisuals.length > 0) {
    return storyboardVisuals;
  }

  return extractNumberedSectionLines(
    script,
    /^장면별\s*화면\s*지시/,
    /^(사용자\s*입력\s*대본|실제\s*쇼츠\s*대본|완성\s*대본|영상 톤|자막 스타일|영상 스타일 디렉션|촬영 컷 리스트|마지막 엔딩)/,
  );
}

export function extractManualStyleDirections(script: string) {
  return script
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^\d+\s*~\s*\d+초/.test(line) || /^\d+\s*초$/.test(line)) {
        return false;
      }

      if (
        /^(자막|영상 톤|영상 스타일 디렉션|촬영 컷 리스트|활용 요소|음악|색감|분위기|전체 콘셉트)\s*[:：]?$/.test(
          line,
        )
      ) {
        return false;
      }

      return /(콘셉트|분위기|색감|음악|비트|감성|웅장|자막|스타일|디렉션|촬영|컷|주황|오렌지|블랙|화이트|스낵|로고|무드|줌|전환|체중계|손가락|운동화|물컵|달력|치토스|브랜드)/.test(
        line,
      );
    })
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .filter((line) => line.length >= 6)
    .slice(0, 24);
}

export function extractBrandMoodRules(script: string) {
  const lines = script
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const brandMoodLines = lines.filter((line) =>
    /(치토스|로고|브랜드|모티브|무드)/.test(line),
  );

  if (brandMoodLines.length === 0) {
    return [];
  }

  return [
    ...brandMoodLines,
    "실제 브랜드명, 로고, 캐릭터, 패키지 디자인은 만들지 않고 색감과 광고 무드만 참고한다.",
  ];
}
