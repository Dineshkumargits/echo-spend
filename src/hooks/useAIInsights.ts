import { useCallback } from 'react';
import Constants from 'expo-constants';
import {
  getCategoryBreakdown,
  getSpendTrend,
  getActiveInsights,
  saveInsight,
  pruneOldInsights,
  Insight,
} from '../services/database';
import { extractJSONArray } from '../utils/extractJSON';
import { notify } from '../utils/notify';
import { OllamaUnreachableError } from '../services/smsParserService';

const extra = Constants.expoConfig?.extra ?? {};
const OLLAMA_ENDPOINT: string = extra.ollamaEndpoint || 'https://ollama.adkdev.in/api/generate';
const MODEL_NAME: string = extra.ollamaModel || 'gemma4:latest';
const CF_CLIENT_ID: string = extra.cfAccessClientId || '';
const CF_CLIENT_SECRET: string = extra.cfAccessClientSecret || '';

async function callOllama(prompt: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (CF_CLIENT_ID) headers['CF-Access-Client-Id'] = CF_CLIENT_ID;
  if (CF_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = CF_CLIENT_SECRET;

  let res: Response;
  try {
    res = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL_NAME,
        prompt,
        stream: false,
        options: { temperature: 0.7 },
      }),
    });
  } catch {
    throw new OllamaUnreachableError();
  }

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new OllamaUnreachableError();
  }

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.response as string;
}

export const useAIInsights = () => {
  /** Load already-cached active insights from DB */
  const getInsights = useCallback(async (): Promise<Insight[]> => {
    return await getActiveInsights();
  }, []);

  /**
   * Generate fresh insights from AI and persist to DB.
   * Call this at most once per day (caller's responsibility to rate-limit).
   */
  const generateInsights = useCallback(async (): Promise<Insight[]> => {
    await pruneOldInsights();

    const [trend, breakdown] = await Promise.all([
      getSpendTrend(14),
      getCategoryBreakdown(),
    ]);

    if (breakdown.length === 0) return [];

    const trendSummary = trend
      .map(p => `${p.date}: ₹${p.total.toFixed(0)}`)
      .join(', ');
    const breakdownSummary = breakdown
      .map(b => `${b.category}: ₹${b.total.toFixed(0)} (${b.percentage}%)`)
      .join(', ');

    const prompt = `You are a personal finance assistant. Analyze this spending data and generate 3 short, specific, actionable insights.

14-day spend trend: ${trendSummary}
This month category breakdown: ${breakdownSummary}

Return a JSON array with exactly 3 objects:
[
  { "type": "weekly_digest" | "anomaly" | "suggestion", "title": "<short title>", "body": "<1-2 sentence insight>" },
  ...
]

Rules:
- Be specific (mention category names and amounts)
- Anomaly: if any day's spend is >2x the average daily spend
- Suggestion: practical money-saving tip based on the data
- Weekly digest: overall summary of spending pattern
- Keep body under 100 characters`;

    try {
      const raw = await callOllama(prompt);

      // Robustly extract JSON array from LLM response
      const items = extractJSONArray<Array<{ type: string; title: string; body: string }>>(raw);
      if (!items || !Array.isArray(items)) throw new Error('No JSON array found in AI response');

      const validTypes = ['weekly_digest', 'anomaly', 'suggestion', 'recurring_detected'];
      const now = new Date().toISOString();
      const saved: Insight[] = [];

      for (const item of items.slice(0, 5)) {
        if (!item.title || !item.body) continue;
        const insight: Omit<Insight, 'id'> = {
          type: validTypes.includes(item.type)
            ? (item.type as Insight['type'])
            : 'suggestion',
          title: item.title.slice(0, 80),
          body: item.body.slice(0, 200),
          generatedAt: now,
        };
        await saveInsight(insight);
        saved.push({ ...insight, id: 0 });
      }

      // Also run local anomaly detection without AI
      const avgDaily = trend.reduce((s, p) => s + p.total, 0) / (trend.length || 1);
      const highDay = trend.find(p => p.total > avgDaily * 2.5);
      if (highDay) {
        const anomaly: Omit<Insight, 'id'> = {
          type: 'anomaly',
          title: `High spend on ${highDay.date}`,
          body: `You spent ₹${highDay.total.toFixed(0)} on ${highDay.date}, ${Math.round(highDay.total / avgDaily)}x your daily average.`,
          generatedAt: now,
        };
        await saveInsight(anomaly);
        saved.push({ ...anomaly, id: 0 });
      }

      return await getActiveInsights();
    } catch (err) {
      if (err instanceof OllamaUnreachableError) {
        notify.info('AI server is down', 'Showing smart local insights — back soon!');
      }
      return await generateLocalInsights(breakdown, trend);
    }
  }, []);

  return { getInsights, generateInsights };
};

async function generateLocalInsights(
  breakdown: Awaited<ReturnType<typeof getCategoryBreakdown>>,
  trend: Awaited<ReturnType<typeof getSpendTrend>>
): Promise<Insight[]> {
  const now = new Date().toISOString();
  const insights: Omit<Insight, 'id'>[] = [];

  if (breakdown.length > 0) {
    const top = breakdown[0];
    insights.push({
      type: 'weekly_digest',
      title: `Top spend: ${top.category}`,
      body: `${top.category} accounts for ${top.percentage}% of your spending this month (₹${top.total.toFixed(0)}).`,
      generatedAt: now,
    });
  }

  const totalSpend = trend.reduce((s, p) => s + p.total, 0);
  if (totalSpend > 0) {
    const avgDaily = totalSpend / trend.filter(p => p.total > 0).length;
    insights.push({
      type: 'suggestion',
      title: 'Daily average',
      body: `Your average daily spend is ₹${avgDaily.toFixed(0)} over the past 14 days.`,
      generatedAt: now,
    });
  }

  for (const insight of insights) {
    await saveInsight(insight);
  }

  return await getActiveInsights();
}
