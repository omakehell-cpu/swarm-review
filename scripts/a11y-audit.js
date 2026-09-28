#!/usr/bin/env node
// scripts/a11y-audit.js -- the automated half of an accessibility check.
//
// Runs axe-core (the engine behind Microsoft Accessibility Insights and
// most other checkers) over the main pages of a running copy of the site,
// in light and dark, against WCAG 2.2 A and AA plus
// axe's best practices, and prints what fails and where.
//
// This catches the mechanical half: contrast, names, labels, landmarks,
// heading order. It cannot tell you whether a page makes sense read
// aloud -- that takes a person with a screen reader.
//
// It needs two development tools the app itself never loads:
//   npm install --no-save playwright axe-core && npx playwright install chromium
// Then, with the server running:
//   A11Y_USER=you A11Y_PASSWORD=secret npm run a11y
// A11Y_BASE defaults to http://localhost:3000. It only reads pages, but a
// copy of the site is still the better place to run it.
'use strict';

let chromium;
let axePath;
try {
  ({ chromium } = require('playwright'));
  axePath = require.resolve('axe-core/axe.min.js');
} catch (e) {
  console.error('Needs playwright and axe-core: npm install --no-save playwright axe-core && npx playwright install chromium');
  process.exit(2);
}
const fs = require('fs');

const BASE = process.env.A11Y_BASE || 'http://localhost:3000';
const USER = process.env.A11Y_USER;
const PASSWORD = process.env.A11Y_PASSWORD;
if (!USER || !PASSWORD) {
  console.error('Set A11Y_USER and A11Y_PASSWORD to an account on the site being checked.');
  process.exit(2);
}
const PAGES = (process.env.A11Y_PAGES || '/,/help,/account,/tags,/glossary,/activity,/stories/new,/search?q=the')
  .split(',').filter(Boolean);
const SCHEMES = ['light', 'dark'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

(async () => {
  const axe = fs.readFileSync(axePath, 'utf8');
  const browser = await chromium.launch();
  const found = new Map();
  for (const scheme of SCHEMES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    await page.fill('input[name=username]', USER);
    await page.fill('input[name=password]', PASSWORD);
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
    // The story and chapter pages of whatever is newest on the front page.
    const home = await (await page.goto(`${BASE}/`)).text();
    const story = (home.match(/href="(\/stories\/\d+)/) || [])[1];
    const extra = [];
    if (story) {
      extra.push(story, `${story}/outline`, `${story}/analysis`, `${story}/timeline`, `${story}/bible`);
      const storyHtml = await (await page.goto(BASE + story)).text();
      const chapter = (storyHtml.match(/href="(\/chapters\/\d+)"/) || [])[1];
      if (chapter) extra.push(chapter, `${chapter}/edit`);
    }
    for (const path of [...PAGES, ...extra]) {
      await page.goto(BASE + path);
      await page.waitForTimeout(400);
      await page.addScriptTag({ content: axe });
      // Runs inside the page, where window and document exist.
      // eslint-disable-next-line no-undef
      const violations = await page.evaluate(async (tags) => (await window.axe.run(document, { runOnly: tags })).violations
        .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) })), TAGS);
      for (const v of violations) {
        const entry = found.get(v.id) || { impact: v.impact, help: v.help, where: new Set(), nodes: new Set() };
        entry.where.add(`${path} (${scheme})`);
        v.nodes.slice(0, 5).forEach((n) => entry.nodes.add(n));
        found.set(v.id, entry);
      }
    }
    await context.close();
  }
  await browser.close();
  if (!found.size) {
    console.log('No violations found.');
    return;
  }
  for (const [id, v] of found) {
    console.log(`\n${id} [${v.impact}] ${v.help}`);
    console.log(`  on: ${[...v.where].slice(0, 8).join('; ')}${v.where.size > 8 ? ` and ${v.where.size - 8} more` : ''}`);
    for (const n of [...v.nodes].slice(0, 5)) console.log(`  - ${n}`);
  }
  process.exitCode = 1;
})();
