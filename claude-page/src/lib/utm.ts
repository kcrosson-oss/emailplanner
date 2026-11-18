// UTM tagging for every link in an email.
//   ?utm_source=email&utm_medium=marketing_YYYYMMDD&utm_campaign=<topic_slug>
// The query goes before any #fragment, and uses & if the URL already has a ?.

/** "MCP Email" → "mcp_email". Same slug for all versions of an email. */
export function topicSlug(topic: string): string {
  return topic
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function utmParams(sendDate: string, topic: string): string {
  const ymd = sendDate.replace(/-/g, '');
  return `utm_source=email&utm_medium=marketing_${ymd}&utm_campaign=${topicSlug(topic)}`;
}

const UTM_KEYS = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

/** The campaign slug an email uses: the brief's UTM campaign if filled in, else the title. */
export const campaignFor = (e: { title: string; brief?: { utmCampaign?: string } }) => topicSlug(e.brief?.utmCampaign?.trim() || e.title);

export function tagUrl(url: string, sendDate: string, topic: string): string {
  const raw = url.trim();
  if (!raw) return '';
  const hashIdx = raw.indexOf('#');
  const beforeHash = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
  const fragment = hashIdx === -1 ? '' : raw.slice(hashIdx);
  const qIdx = beforeHash.indexOf('?');
  const base = qIdx === -1 ? beforeHash : beforeHash.slice(0, qIdx);
  const existing = qIdx === -1 ? '' : beforeHash.slice(qIdx + 1);
  // Keep any non-UTM params; drop old UTM values so re-tagging never duplicates them.
  const kept = existing
    .split('&')
    .filter((p) => p && !UTM_KEYS.has(p.split('=')[0].toLowerCase()));
  const query = [...kept, utmParams(sendDate, topic)].join('&');
  return `${base}?${query}${fragment}`;
}
