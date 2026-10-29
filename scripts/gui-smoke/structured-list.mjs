export async function run({ evaluate, screenshot }) {
  const structuredList = await evaluate(`(() => {
    const root = [...document.querySelectorAll('.markdown-body ol')].find((list) =>
      [...list.children].some((child) => child.tagName === 'LI' && child.textContent.includes('リスト親'))
    );
    if (!root) return { found: false };
    root.scrollIntoView({ block: 'center', inline: 'nearest' });
    const directItems = [...root.children].filter((child) => child.tagName === 'LI');
    const first = directItems[0];
    const standardRoot = [...document.querySelectorAll('.markdown-body ol')].find((list) =>
      [...list.children].some((child) => child.tagName === 'LI' && child.textContent.includes('親A'))
    );
    const standardItems = [...(standardRoot?.children ?? [])].filter((child) => child.tagName === 'LI');
    const orderedDepth = first?.querySelector(':scope > ol > li > ol > li') ? 3 : 0;
    const bullets = [...(first?.querySelectorAll('ul') ?? [])].map((list) => ({
      text: list.querySelector(':scope > li > p')?.textContent ?? list.querySelector(':scope > li')?.firstChild?.textContent ?? '',
      markerClass: [...list.classList].find((name) => name.startsWith('markdown-list-marker-')) ?? '',
    }));
    return {
      found: true,
      directItems: directItems.length,
      orderedDepth,
      bullets,
      joinedOrderedText: [...first.querySelectorAll('p')].some((paragraph) => paragraph.textContent.includes('1. リスト孫')),
      standardDirectItems: standardItems.length,
      standardChildItems: standardItems[0]?.querySelectorAll(':scope > ol > li').length ?? 0,
      standardJoinedText: [...(standardItems[0]?.querySelectorAll('p') ?? [])].some((paragraph) => paragraph.textContent.includes('1. 子A-1')),
    };
  })()`);
  const structuredListScreenshot = await screenshot("structured-list.png");
  const expectedMarkerClasses = [
    "markdown-list-marker-odd",
    "markdown-list-marker-even",
    "markdown-list-marker-odd",
    "markdown-list-marker-even",
  ];
  if (!structuredList.found || structuredList.directItems !== 2 || structuredList.orderedDepth !== 3
    || structuredList.joinedOrderedText || structuredList.standardDirectItems !== 2
    || structuredList.standardChildItems !== 2 || structuredList.standardJoinedText
    || JSON.stringify(structuredList.bullets.map((item) => item.markerClass)) !== JSON.stringify(expectedMarkerClasses)) {
    throw new Error(`Structured list verification failed: ${JSON.stringify(structuredList)}`);
  }

  return { structuredList, structuredListScreenshot };
}
