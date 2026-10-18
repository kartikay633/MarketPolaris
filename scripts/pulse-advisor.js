import { recordModelPortfolios, scorePlans } from '../server/research/advisor.js';

// Pipeline step: record today's model portfolios (write-once) and score matured plans.
const mode = process.argv[2] || 'all';
try {
  if (mode === 'record' || mode === 'all') console.log(JSON.stringify({ recordedModelPlans: (await recordModelPortfolios()).length }));
  if (mode === 'score' || mode === 'all') {
    const report = await scorePlans();
    console.log(JSON.stringify({ plans: report.plans, open: report.open, model: report.model }));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
