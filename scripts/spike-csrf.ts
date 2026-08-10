/**
 * LeetCode fetch smoke test.
 *
 * Fetches the single slug `two-sum` end to end and confirms that `content`,
 * `hints`, `exampleTestcases`, and `codeSnippets` all come back non-null.
 *
 * Standalone and dependency-free on purpose, so a failure here points at the
 * fetch path itself rather than at shared module code.
 *
 *   npx tsx scripts/spike-csrf.ts
 */

export {}; // make this a module, so its consts are not global-scoped

const SLUG = 'two-sum';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const QUESTION_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    isPaidOnly
    likes
    dislikes
    stats
    hints
    exampleTestcases
    topicTags { name slug }
    codeSnippets { lang langSlug code }
    similarQuestions
  }
}`;

/** Pull a named cookie out of a Set-Cookie header list. */
function readCookie(setCookie: string[], name: string): string | null {
  for (const line of setCookie) {
    const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return null;
}

async function main(): Promise<void> {
  const problemUrl = `https://leetcode.com/problems/${SLUG}/`;

  // ---- Step 1: obtain a csrftoken -----------------------------------------
  //
  // Harvested from a cheap GET against /graphql rather than from a problem
  // page: leetcode.com HTML sits behind a Cloudflare interstitial that 403s,
  // while /graphql issues the same cookie itself.
  const tokenUrl = 'https://leetcode.com/graphql';
  console.log(`[1/3] GET ${tokenUrl}  (csrftoken harvest; page HTML is CF-blocked)`);
  const tokenRes = await fetch(tokenUrl, {
    headers: { 'User-Agent': UA },
  });
  console.log(`      status ${tokenRes.status} ${tokenRes.statusText}`);

  // getSetCookie() is the only way to see multiple Set-Cookie headers; a plain
  // .get() folds them into one comma-joined string and mangles cookie values.
  const setCookie = tokenRes.headers.getSetCookie();
  const csrf = readCookie(setCookie, 'csrftoken');
  const sessionCookie = readCookie(setCookie, 'LEETCODE_SESSION');
  await tokenRes.text(); // drain the body so the socket is released

  console.log(`      Set-Cookie headers: ${setCookie.length}`);
  console.log(`      csrftoken: ${csrf ? `present (len ${csrf.length})` : 'MISSING'}`);
  if (!csrf) {
    throw new Error(
      'no csrftoken in Set-Cookie',
    );
  }

  // ---- Step 2: POST the GraphQL query -------------------------------------
  const cookieParts = [`csrftoken=${csrf}`];
  if (sessionCookie) cookieParts.push(`LEETCODE_SESSION=${sessionCookie}`);

  console.log(`[2/3] POST https://leetcode.com/graphql (questionData: ${SLUG})`);
  const gqlRes = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Cookie: cookieParts.join('; '),
      'x-csrftoken': csrf,
      Referer: problemUrl,
      Origin: 'https://leetcode.com',
    },
    body: JSON.stringify({
      operationName: 'questionData',
      query: QUESTION_QUERY,
      variables: { titleSlug: SLUG },
    }),
  });
  console.log(`      status ${gqlRes.status} ${gqlRes.statusText}`);

  const raw = await gqlRes.text();
  if (!gqlRes.ok) {
    console.error(`      body (first 500): ${raw.slice(0, 500)}`);
    throw new Error(`graphql returned ${gqlRes.status}`);
  }

  // Untrusted upstream JSON. Narrowed field by field below rather than cast.
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('graphql response was not an object');
  }
  const envelope = parsed as { data?: unknown; errors?: unknown };
  if (envelope.errors) {
    console.error(`      graphql errors: ${JSON.stringify(envelope.errors).slice(0, 500)}`);
    throw new Error('graphql returned an errors array');
  }
  const data = envelope.data as { question?: Record<string, unknown> } | undefined;
  const q = data?.question;
  if (!q) throw new Error('graphql response had no data.question');

  // ---- Step 3: assert the four required captures --------------------------
  console.log('[3/3] Checking required fields');

  const content = q.content;
  const hints = q.hints;
  const exampleTestcases = q.exampleTestcases;
  const codeSnippets = q.codeSnippets;

  const checks: Array<[string, boolean, string]> = [
    [
      'content',
      typeof content === 'string' && content.length > 0,
      typeof content === 'string' ? `${content.length} chars` : String(content),
    ],
    [
      'hints',
      Array.isArray(hints),
      Array.isArray(hints) ? `${hints.length} hint(s)` : String(hints),
    ],
    [
      'exampleTestcases',
      typeof exampleTestcases === 'string' && exampleTestcases.length > 0,
      typeof exampleTestcases === 'string'
        ? JSON.stringify(exampleTestcases.slice(0, 40))
        : String(exampleTestcases),
    ],
    [
      'codeSnippets',
      Array.isArray(codeSnippets) && codeSnippets.length > 0,
      Array.isArray(codeSnippets) ? `${codeSnippets.length} language(s)` : String(codeSnippets),
    ],
  ];

  console.log('');
  let allPass = true;
  for (const [name, ok, detail] of checks) {
    console.log(`      ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} ${detail}`);
    if (!ok) allPass = false;
  }

  // Context fields that are useful to eyeball but are not gate conditions.
  console.log('');
  console.log(`      title        : ${String(q.title)}`);
  console.log(`      frontendId   : ${String(q.questionFrontendId)}`);
  console.log(`      difficulty   : ${String(q.difficulty)}`);
  console.log(`      isPaidOnly   : ${String(q.isPaidOnly)}`);
  if (Array.isArray(q.topicTags)) {
    const slugs = q.topicTags
      .map((t) => (typeof t === 'object' && t !== null ? String((t as { slug?: unknown }).slug) : '?'))
      .join(', ');
    console.log(`      topicTags    : ${slugs}`);
  }
  if (Array.isArray(codeSnippets)) {
    const langs = codeSnippets
      .map((s) =>
        typeof s === 'object' && s !== null ? String((s as { langSlug?: unknown }).langSlug) : '?',
      )
      .join(', ');
    console.log(`      langSlugs    : ${langs}`);
  }
  if (typeof content === 'string') {
    console.log('');
    console.log(`      content[0:180]: ${content.slice(0, 180).replace(/\n/g, ' ')}`);
  }

  console.log('');
  if (!allPass) throw new Error('one or more required fields were null/empty');
  console.log('SPIKE PASSED — all four required fields present.');
}

main().catch((err: unknown) => {
  console.error('');
  console.error('SPIKE FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
