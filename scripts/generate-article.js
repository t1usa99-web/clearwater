/**
 * ClearWater — Daily Article Generator
 *
 * Usage: node scripts/generate-article.js
 * Requires: ANTHROPIC_API_KEY environment variable
 *
 * Picks the next unpublished topic from TOPICS, calls the Anthropic API
 * to generate a long-form article, and appends it to articles.json.
 *
 * Run locally to test, or via GitHub Actions for daily automation.
 */

import https   from 'https';
import fs      from 'fs';
import path    from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ARTICLES_FILE = path.join(__dirname, '..', 'articles.json');
const API_KEY       = process.env.ANTHROPIC_API_KEY;

// ─── Topic queue ──────────────────────────────────────────────────
// Topics are published in order; already-published slugs are skipped.
// Add more topics here to keep the queue going indefinitely.
const TOPICS = [
  // ── Contaminant deep-dives ────────────────────────────────────
  {
    slug:     'pfas-in-drinking-water-complete-guide',
    title:    'PFAS in Drinking Water: Complete Guide for 2026',
    category: 'contaminants',
    focus:    'PFAS (per- and polyfluoroalkyl substances) in tap water — what they are, where they come from (military bases, Teflon manufacturing, firefighting foam), the new EPA MCLs for PFOS and PFOA set in April 2024, health risks (cancer, immune disruption, thyroid), states with highest contamination, how to find out if your tap water has PFAS, and the best water filters (reverse osmosis, activated carbon) that remove PFAS.',
  },
  {
    slug:     'lead-drinking-water-homeowner-guide',
    title:    'Lead in Drinking Water: What Every Homeowner Needs to Know',
    category: 'contaminants',
    focus:    'How lead gets into drinking water (old pipes, solder, fixtures — not treatment plants), health effects especially on children (IQ loss, developmental delays), the 15 ppb EPA action level under the Lead and Copper Rule, cities with the worst lead problems (Flint MI, Newark NJ, Pittsburgh PA), how to test your home water for lead, and the best certified filters for lead removal.',
  },
  {
    slug:     'chromium-6-tap-water-guide',
    title:    'Chromium-6 in Tap Water: The Erin Brockovich Chemical Explained',
    category: 'contaminants',
    focus:    'Hexavalent chromium (chromium-6 / Cr-VI) in drinking water — what it is, why it became famous through the Erin Brockovich case in Hinkley CA, difference between Cr-III and Cr-VI, known carcinogen classification, current EPA MCL of 100 ppb for total chromium (no federal standard yet for Cr-VI specifically), California\'s stricter 10 ppb MCL, states and utilities with the highest levels, and water filter options.',
  },
  {
    slug:     'nitrates-drinking-water-rural-risks',
    title:    'Nitrates in Drinking Water: Risks for Infants and Rural Communities',
    category: 'contaminants',
    focus:    'Nitrate contamination from agricultural fertilizer and animal waste runoff — the MCL of 10 mg/L as nitrogen, how nitrates cause blue baby syndrome (methemoglobinemia) in infants under 6 months, most affected states (Iowa, Illinois, Indiana, Nebraska, Kansas, California Central Valley), private well risks, and treatment options (reverse osmosis, ion exchange).',
  },
  {
    slug:     'arsenic-well-water-guide',
    title:    'Arsenic in Well Water: A Hidden Health Risk for Rural Homeowners',
    category: 'contaminants',
    focus:    'Naturally occurring arsenic in groundwater — how it forms geologically, the 10 ppb MCL, health risks (skin, bladder, lung cancer with long-term exposure), regions with highest arsenic in the US (Southwest: AZ, NM, NV; New England; parts of Midwest), why private wells are not regulated by EPA, how to test, and water treatment options (reverse osmosis, iron/arsenic filters).',
  },
  {
    slug:     'disinfection-byproducts-tthm-haa5',
    title:    'Disinfection Byproducts in Tap Water: TTHMs and HAA5 Explained',
    category: 'contaminants',
    focus:    'How chlorine reacts with natural organic matter to form trihalomethanes (TTHMs) and haloacetic acids (HAA5) — why these are the most common type of EPA violation nationwide, the MCLs (80 µg/L for TTHM, 60 µg/L for HAA5), long-term cancer and reproductive risks, which utilities and regions have the most violations, how to reduce exposure (letting water sit uncovered, using carbon filters), and what utilities are doing to address it.',
  },
  {
    slug:     'radium-tap-water-midwest',
    title:    'Radium in Tap Water: The Silent Radiation Risk in Midwestern Water Supplies',
    category: 'contaminants',
    focus:    'Naturally occurring radium in deep groundwater — how radium gets into water from underground rock formations, the combined radium MCL of 5 pCi/L, bone cancer risk with lifetime exposure, which states and utilities have the highest radium levels (Illinois, Iowa, Wisconsin, Minnesota, Texas), how to check if your utility has radium violations, and treatment systems used by utilities and homeowners.',
  },
  {
    slug:     'chloramine-vs-chlorine-tap-water',
    title:    'Chloramine vs. Chlorine in Tap Water: What\'s the Difference?',
    category: 'contaminants',
    focus:    'Why many US water utilities switched from chlorine to chloramine as a disinfectant — how both work, why chloramine produces fewer TTHMs (a regulatory advantage), but creates other DBPs like iodoacetic acid; health debate around chloramines; what it means practically (cannot use chloramine-treated water in fish tanks or kidney dialysis without special treatment); how to find out which your utility uses; and whether you should filter it.',
  },
  // ── How-to guides ─────────────────────────────────────────────
  {
    slug:     'how-to-read-consumer-confidence-report',
    title:    'How to Read Your Annual Water Quality Report (Consumer Confidence Report)',
    category: 'guides',
    focus:    'Step-by-step guide to understanding Consumer Confidence Reports (CCRs) that utilities must mail annually — what MCL vs MCLG means, health-based vs non-health-based violations, what "detected but below MCL" means, how to find your CCR online, what to do if your utility has violations, and how ClearWater\'s free EPA lookup can supplement your CCR with violation history going back 10 years.',
  },
  {
    slug:     'best-water-filters-lead-removal-2026',
    title:    'Best Water Filters for Lead Removal in 2026 (NSF-Certified Options)',
    category: 'guides',
    focus:    'Comparison of water filter types for lead removal — reverse osmosis systems (most effective, removes 95%+), solid carbon block filters (NSF/ANSI Standard 53 certified options), pitcher filters (Brita vs ZeroWater vs PUR), under-sink vs countertop, cost comparison over 5 years, why you should test first before buying, what "NSF/ANSI 53 certified" means and why it matters for lead, and recommendations by budget.',
  },
  {
    slug:     'private-well-water-testing-guide',
    title:    'Private Well Water Testing: Complete Guide for Homeowners',
    category: 'guides',
    focus:    'Why the EPA does not regulate private wells (unlike municipal water), what contaminants to test for and when (bacteria/coliform annually, nitrates annually, arsenic, radon, pH, hardness, volatile organics if near industrial sites), how to find a certified lab in your state, how to interpret results, the most common problems found in well water by region, and treatment options for each (UV for bacteria, RO for arsenic/nitrates, water softeners for hardness).',
  },
  {
    slug:     'tap-water-vs-bottled-water-comparison',
    title:    'Tap Water vs. Bottled Water: The Real Comparison (2026)',
    category: 'guides',
    focus:    'The full comparison between tap and bottled water — regulatory differences (EPA strictly regulates tap via Safe Drinking Water Act; FDA regulates bottled water more loosely), shocking cases where bottled water contained more contaminants than tap, cost comparison ($1,000+/year for bottled water vs <$1 for tap), environmental impact (plastic waste, carbon footprint), taste test results, when filtered tap is the best option, and how to check your specific tap water quality with ClearWater.',
  },
  {
    slug:     'understanding-epa-water-violations',
    title:    'EPA Water Quality Violations Explained: What They Mean for Your Safety',
    category: 'guides',
    focus:    'Plain-English guide to EPA water violations — the difference between MCL violations (exceeding a contaminant limit), Treatment Technique violations (failing to follow required treatment processes), and Monitoring/Reporting violations (failing to test and report); why health-based violations are serious while monitoring violations may just be paperwork issues; what utilities must do when they have a violation (public notice requirements); how long violations stay on record; and how to look up your utility\'s violation history for free.',
  },
  {
    slug:     'water-quality-pregnancy-safety-guide',
    title:    'Is Your Tap Water Safe During Pregnancy? A Complete Guide',
    category: 'guides',
    focus:    'Drinking water safety during pregnancy — which contaminants are most dangerous for pregnant women and developing fetuses (lead, nitrates, arsenic, PFAS, disinfection byproducts), EPA guidelines vs more protective standards for pregnancy, which violations to take most seriously, when to use a filter vs bottled water as a precaution, how to look up your specific water system\'s violation history, and practical steps to reduce exposure.',
  },
  // ── State water quality guides ─────────────────────────────────
  {
    slug:     'michigan-water-quality-guide',
    title:    'Michigan Tap Water Quality: Flint, Detroit, PFAS, and What\'s Changed',
    category: 'states',
    focus:    'Michigan\'s water quality story — the Flint lead crisis (2014-2019) and its causes (corrosive river water, inadequate treatment, failures at every level), Detroit\'s ongoing lead pipe replacement program, PFAS contamination near Wurtsmith and Selfridge Air Force Bases, Michigan\'s aggressive state-level response (stricter than federal PFAS standards), and the current state of drinking water safety across Michigan\'s major cities and rural areas.',
  },
  {
    slug:     'california-tap-water-quality-guide',
    title:    'California Tap Water Quality: What\'s in the Water Across the State?',
    category: 'states',
    focus:    'California\'s diverse water quality challenges — nitrate contamination in the Central Valley\'s agricultural regions (small systems serving farmworker communities), arsenic in small groundwater systems in the Mojave, PFAS contamination near military installations, the state\'s strict regulatory environment (often ahead of federal standards), how drought and water source diversification affect water quality, and how major cities (Los Angeles, San Francisco, San Diego, Sacramento) stack up.',
  },
  {
    slug:     'texas-tap-water-quality-guide',
    title:    'Texas Tap Water Quality: What You Need to Know in 2026',
    category: 'states',
    focus:    'Texas water quality across the state\'s diverse regions — Houston\'s surface water treatment and TTHM history, San Antonio\'s Edwards Aquifer (generally excellent), Dallas-Fort Worth infrastructure age, El Paso\'s TTHM violations, the impact of the 2021 winter storm on water infrastructure and water quality, nitrates and arsenic in rural West Texas well water, and how to look up any Texas water system\'s EPA record.',
  },
  {
    slug:     'florida-tap-water-quality-guide',
    title:    'Florida Tap Water Quality: What\'s in Your Tap Water?',
    category: 'states',
    focus:    'Florida\'s unique water quality situation — the Floridan Aquifer as the primary source (naturally high in minerals including radon), PFAS contamination near military bases in Pensacola and elsewhere, disinfection byproduct violations in coastal cities dealing with high organic content water, naturally occurring radium in some systems, how major cities compare (Miami, Tampa, Orlando, Jacksonville, Fort Lauderdale), and the impact of climate change and saltwater intrusion on Florida\'s drinking water future.',
  },
  {
    slug:     'new-jersey-water-quality-guide',
    title:    'New Jersey Tap Water: Lead, PFAS, and the Fight for Cleaner Water',
    category: 'states',
    focus:    'New Jersey\'s complex water quality history — the Newark lead crisis (2017-2021, worse than Flint in some metrics), PFAS contamination in the Pinelands region and near Lakehurst Naval Air Station, New Jersey\'s aggressive state-level PFAS regulations (among the strictest in the country), lead service line replacement timelines, how utilities across NJ compare, and what Jersey City\'s experience shows about aging infrastructure nationwide.',
  },
];

// ─── Anthropic API call ───────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-3-5-haiku-20241022',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data',  (chunk) => { data += chunk; });
      res.on('end',   () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nRaw: ${data.slice(0, 500)}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Article generation ───────────────────────────────────────────
async function generateArticle(topic) {
  const prompt = `You are writing a long-form SEO pillar article for ClearWater (checkclearwater.com), a free EPA drinking water quality lookup tool that helps Americans understand what's in their tap water.

Write a comprehensive, authoritative article on: **${topic.title}**

FOCUS AREA: ${topic.focus}

REQUIREMENTS:
- 2,000–2,500 words of substantive content
- Authoritative, factual, and science-backed (cite specific EPA regulations, MCL values, study findings where relevant)
- Written for concerned homeowners, parents, and renters — not scientists. Plain language, no jargon without explanation.
- Actionable: include specific steps readers can take today
- Structured with H2 and H3 headings optimized for search and featured snippets
- Naturally mention ClearWater's free ZIP code lookup 1-2 times where it's genuinely helpful (not forced)
- Do NOT include any affiliate links or product recommendations with prices

OUTPUT: Return ONLY valid JSON with no markdown code fences, no preamble, no explanation. Just the raw JSON object:
{
  "excerpt": "A 1-2 sentence summary suitable for article cards and meta descriptions. Max 160 characters.",
  "content": "Full article HTML using only these tags: h2, h3, p, ul, li, ol, strong, em, a. For links, use relative URLs like /contaminant/lead or /tx/houston only when directly relevant."
}

The content must be valid HTML. Do not include h1 (the page template adds it). Start with an introductory paragraph, then use h2 for main sections.`;

  console.log('  Calling Anthropic API...');
  const response = await callClaude(prompt);

  if (response.error) {
    throw new Error(`API error: ${JSON.stringify(response.error)}`);
  }

  const rawText = response.content[0].text.trim();

  // Strip markdown code fences if the model wrapped the JSON
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Failed to parse article JSON: ${e.message}\nRaw (first 500 chars): ${jsonText.slice(0, 500)}`);
  }

  if (!parsed.excerpt || !parsed.content) {
    throw new Error(`Missing required fields. Keys found: ${Object.keys(parsed).join(', ')}`);
  }

  return parsed;
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.error('❌  ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  // Load existing articles
  let articles = [];
  if (fs.existsSync(ARTICLES_FILE)) {
    try {
      articles = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8'));
      console.log(`📚  Loaded ${articles.length} existing articles`);
    } catch (e) {
      console.error('⚠️   Could not parse articles.json, starting fresh:', e.message);
    }
  }

  // Find next unpublished topic
  const published = new Set(articles.map(a => a.slug));
  const topic     = TOPICS.find(t => !published.has(t.slug));

  if (!topic) {
    console.log('✅  All topics have been published. Add more to the TOPICS array to continue.');
    process.exit(0);
  }

  console.log(`\n📝  Generating: "${topic.title}"`);
  console.log(`    Category: ${topic.category} | Slug: ${topic.slug}`);

  const { excerpt, content } = await generateArticle(topic);

  const wordCount = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

  const article = {
    slug:      topic.slug,
    title:     topic.title,
    excerpt,
    content,
    date:      new Date().toISOString().split('T')[0],
    category:  topic.category,
    wordCount,
  };

  // Prepend so newest articles appear first
  articles.unshift(article);
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2), 'utf8');

  console.log(`\n✅  Published: ${topic.slug}`);
  console.log(`    Word count: ~${wordCount}`);
  console.log(`    Excerpt:    ${excerpt.slice(0, 100)}...`);
  console.log(`    Saved to:   ${ARTICLES_FILE}`);
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
