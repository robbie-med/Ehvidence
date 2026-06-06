import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const readmePath = path.join(root, 'README.md');
const topicsDir = path.join(root, 'src', 'content', 'topics');
const svgDir = path.join(root, 'assets');
const coverageSvgPath = path.join(svgDir, 'coverage-by-category.svg');
const heatmapSvgPath = path.join(svgDir, 'contributions-heatmap.svg');

function studyPatients(study) {
  if (study.data?.kind === '2x2') {
    return (study.data.txTotal ?? 0) + (study.data.ctrlTotal ?? 0);
  }
  return study.n ?? 0;
}

function fmtInt(num) {
  return num.toLocaleString('en-US');
}

function categoryTotals(topics) {
  const totals = new Map();
  for (const topic of topics) {
    totals.set(topic.category, (totals.get(topic.category) ?? 0) + topic.studyCount);
  }
  return [...totals.entries()]
    .map(([category, articles]) => ({ category, articles }))
    .sort((a, b) => b.articles - a.articles);
}

function contributionsByDate(topics) {
  const counts = new Map();
  const dates = new Set();

  for (const topic of topics) {
    if (!topic.lastUpdated) continue;
    dates.add(topic.lastUpdated);
    counts.set(topic.lastUpdated, (counts.get(topic.lastUpdated) ?? 0) + 1);
  }

  const sortedDates = [...dates].sort();
  return { counts, dates: sortedDates };
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function writeCoverageSvg(topics) {
  const categories = categoryTotals(topics);
  if (categories.length === 0) return;
  await mkdir(svgDir, { recursive: true });

  const width = 760;
  const height = 320;
  const margin = 40;
  const labelWidth = 180;
  const barGap = 14;
  const chartHeight = height - margin * 2;
  const barHeight = Math.max(20, (chartHeight - barGap * (categories.length - 1)) / categories.length);
  const maxArticles = Math.max(...categories.map((item) => item.articles));
  const xScale = (width - margin * 2 - labelWidth) / Math.max(maxArticles, 1);

  const bars = categories.map((item, index) => {
    const y = margin + index * (barHeight + barGap);
    const barWidth = Math.round(item.articles * xScale);
    return { ...item, y, barWidth };
  });

  const svgLines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Article totals by topic category">`,
    `<style>`,
    `  .title { font: 700 16px system-ui, sans-serif; fill: #6b7280; }`,
    `  .label { font: 600 12px system-ui, sans-serif; fill: #6b7280; }`,
    `  .value { font: 600 12px system-ui, sans-serif; fill: #6b7280; }`,
    `  .bar { fill: #1a7f37; }`,
    `  .axis { stroke: #d8d8d8; stroke-width: 1; }`,
    `</style>`,
    `<rect width="100%" height="100%" fill="transparent" rx="12" ry="12"/>`,
    `<text x="${margin}" y="${margin - 8}" class="title">Article totals by topic category</text>`,
    `<line x1="${margin + labelWidth}" y1="${margin - 12}" x2="${margin + labelWidth}" y2="${height - margin + 8}" class="axis"/>`,
  ];

  for (const item of bars) {
    svgLines.push(`  <text x="${margin}" y="${item.y + barHeight / 2 + 5}" class="label">${escapeXml(item.category)}</text>`);
    svgLines.push(`  <rect x="${margin + labelWidth}" y="${item.y}" width="${item.barWidth}" height="${barHeight}" class="bar" rx="6" ry="6"/>`);
    svgLines.push(`  <text x="${margin + labelWidth + item.barWidth + 10}" y="${item.y + barHeight / 2 + 5}" class="value">${fmtInt(item.articles)}</text>`);
  }

  svgLines.push('</svg>');
  await writeFile(coverageSvgPath, svgLines.join('\n'), 'utf8');
}

async function writeHeatmapSvg(topics) {
  const { counts, dates } = contributionsByDate(topics);
  if (dates.length === 0) return;
  await mkdir(svgDir, { recursive: true });

  const cellSize = 12;
  const cellGap = 4;
  const marginTop = 28;
  const marginLeft = 52;
  const startDate = new Date(dates[0]);
  const endDate = new Date(dates[dates.length - 1]);
  const startDay = startDate.getDay();
  const firstSunday = new Date(startDate);
  firstSunday.setDate(startDate.getDate() - startDay);

  const allDays = [];
  for (let d = new Date(firstSunday); d <= endDate; d.setDate(d.getDate() + 1)) {
    allDays.push(new Date(d));
  }

  const weeks = Math.max(Math.ceil(allDays.length / 7), 10);
  const width = marginLeft + weeks * (cellSize + cellGap) + 16;
  const height = marginTop + 7 * (cellSize + cellGap) + 24;
  const maxCount = Math.max(...counts.values(), 1);

  const svgLines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Article contributions over time">`,
    `<style>`,
    `  .label { font: 600 10px system-ui, sans-serif; fill: #6b7280; }`,
    `  .month { font: 600 10px system-ui, sans-serif; fill: #6b7280; }`,
    `  .cell { rx: 3; ry: 3; }`,
    `</style>`,
    `<rect width="100%" height="100%" fill="transparent"/>`,
  ];

  const colorStops = [
    'transparent',
    'rgba(198, 228, 139, 0.65)',
    'rgba(126, 195, 83, 0.70)',
    'rgba(71, 163, 35, 0.78)',
    'rgba(47, 128, 26, 0.92)',
  ];

  const monthEntries = [];
  for (let i = 0; i < allDays.length; i += 1) {
    const date = allDays[i];
    const weekIndex = Math.floor(i / 7);
    if (date.getDate() === 1 || (i === 0 && date.getDate() !== 1)) {
      monthEntries.push({ weekIndex, monthName: date.toLocaleString('default', { month: 'short' }) });
    }
  }

  let lastMonthX = -Infinity;
  const minMonthGap = (cellSize + cellGap) * 3;
  for (const { weekIndex, monthName } of monthEntries) {
    const x = marginLeft + weekIndex * (cellSize + cellGap);
    if (x - lastMonthX < minMonthGap) continue;
    svgLines.push(`  <text x="${x + cellSize / 2}" y="${marginTop - 10}" class="month" text-anchor="middle">${escapeXml(monthName)}</text>`);
    lastMonthX = x;
  }

  for (let i = 0; i < allDays.length; i += 1) {
    const date = allDays[i];
    const weekIndex = Math.floor(i / 7);
    const dayIndex = date.getDay();
    const x = marginLeft + weekIndex * (cellSize + cellGap);
    const y = marginTop + dayIndex * (cellSize + cellGap);
    const key = date.toISOString().slice(0, 10);
    const count = counts.get(key) ?? 0;
    const level = Math.min(count, colorStops.length - 1);
    const fill = count === 0 ? 'transparent' : colorStops[level];
    svgLines.push(`  <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${fill}" class="cell"/>`);
  }

  const weekdays = ['Mon', 'Wed', 'Fri'];
  for (let labelIndex = 0; labelIndex < weekdays.length; labelIndex += 1) {
    const day = [1, 3, 5][labelIndex];
    const y = marginTop + day * (cellSize + cellGap) + 9;
    svgLines.push(`  <text x="20" y="${y}" class="label" text-anchor="start">${weekdays[labelIndex]}</text>`);
  }

  svgLines.push('</svg>');
  await writeFile(heatmapSvgPath, svgLines.join('\n'), 'utf8');
}

async function loadTopics() {
  const files = await readdir(topicsDir);
  const topics = [];

  for (const file of files.filter((file) => file.endsWith('.json'))) {
    const content = await readFile(path.join(topicsDir, file), 'utf8');
    const raw = JSON.parse(content);

    const studyInfoByKey = new Map();
    for (const study of raw.studies ?? []) {
      const key = study.citation || study.id;
      const patients = studyPatients(study);
      const existing = studyInfoByKey.get(key);
      if (!existing) {
        studyInfoByKey.set(key, { year: study.year, patients });
      } else {
        existing.patients = Math.max(existing.patients, patients);
        if (study.year < existing.year) existing.year = study.year;
      }
    }

    const totalPatients = [...studyInfoByKey.values()].reduce((sum, study) => sum + study.patients, 0);
    const studyCount = studyInfoByKey.size;
    topics.push({
      name: raw.name,
      slug: raw.slug,
      category: raw.category ?? '—',
      patients: totalPatients,
      studyCount,
      lastUpdated: raw.lastUpdated ?? null,
      studies: [...studyInfoByKey.values()],
    });
  }

  return topics.sort((a, b) => a.name.localeCompare(b.name));
}

async function updateReadme() {
  const readme = await readFile(readmePath, 'utf8');
  const startMarker = '<!-- TOPICS-COVERAGE:START -->';
  const endMarker = '<!-- TOPICS-COVERAGE:END -->';
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('README markers not found. Please include the coverage markers in README.md.');
  }

  const before = readme.slice(0, startMarker.length + startIndex);
  const after = readme.slice(endIndex);

  const topics = await loadTopics();
  const topicCount = topics.length;
  const articleCount = topics.reduce((sum, topic) => sum + topic.studyCount, 0);
  const patientCount = topics.reduce((sum, topic) => sum + topic.patients, 0);

  const lines = [
    '',
    `**Topics covered:** ${topicCount}`,
    `**Articles covered:** ${fmtInt(articleCount)}`,
    `**Total patients analyzed:** ${fmtInt(patientCount)}`,
    '',
    '| Topic | Articles | Patients | Category |',
    '| --- | ---: | ---: | --- |',
    ...topics.map((topic) => `| ${topic.name} | ${fmtInt(topic.studyCount)} | ${fmtInt(topic.patients)} | ${topic.category} |`),
    '',
  ];

  const updated = `${before}\n${lines.join('\n')}${after}`;
  await writeFile(readmePath, updated, 'utf8');
  await writeCoverageSvg(topics);
  await writeHeatmapSvg(topics);
  console.log(`Updated README with ${topicCount} topics, ${fmtInt(articleCount)} articles, and ${fmtInt(patientCount)} patients.`);
}

updateReadme().catch((error) => {
  console.error(error);
  process.exit(1);
});
