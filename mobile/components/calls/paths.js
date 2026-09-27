// Which networks each phone offered during a call, in words.
//
// When a call cannot connect, "could not find a path" is true and useless.
// What helps is knowing what each phone put on the table: a Tailscale address
// means the two can reach each other over the tailnet with no relay at all,
// and its absence on one side is almost always the whole story.

const inRange = (ip, a, lo, hi) => {
  const [p, q] = ip.split('.').map(Number);
  return p === a && q >= lo && q <= hi;
};

/** One ICE candidate line to a plain label. */
export function candidateLabel(line = '') {
  const parts = String(line).replace(/^a=/, '').trim().split(/\s+/);
  const typIndex = parts.indexOf('typ');
  const type = typIndex > 0 ? parts[typIndex + 1] : null;
  const ip = parts[4] || '';
  if (!type) return null;
  if (type === 'relay') return 'relay';
  if (type === 'srflx' || type === 'prflx') return 'internet';
  if (ip.endsWith('.local')) return 'local network';
  if (ip.includes(':')) return 'IPv6';
  if (inRange(ip, 100, 64, 127)) return 'Tailscale';
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || inRange(ip, 172, 16, 31)) return 'local network';
  return 'internet';
}

/** Candidate lines from an SDP, plus any trickled separately. */
export function candidateLines(sdp, extra = []) {
  const fromSdp = String(sdp || '').split(/\r?\n/).filter((l) => l.startsWith('a=candidate:'));
  return [...fromSdp, ...extra];
}

const ORDER = ['Tailscale', 'local network', 'internet', 'IPv6', 'relay'];

export function labelsOf(lines) {
  const found = new Set(lines.map(candidateLabel).filter(Boolean));
  return ORDER.filter((l) => found.has(l));
}

/** The sentence added under a failed call. */
export function describePaths(localLines, remoteLines) {
  const mine = labelsOf(localLines);
  const theirs = labelsOf(remoteLines);
  const list = (labels) => (labels.length ? labels.join(', ') : 'nothing');
  const lines = [`This phone offered: ${list(mine)}.`, `The other phone offered: ${list(theirs)}.`];

  const meTs = mine.includes('Tailscale');
  const themTs = theirs.includes('Tailscale');
  if (theirs.length === 0) {
    lines.push('Nothing arrived from the other phone, so the live connection dropped while the call was being set up.');
  } else if (meTs && themTs) {
    lines.push('Both phones offered a Tailscale address, so check that Tailscale shows Connected on both.');
  } else if (meTs || themTs) {
    lines.push(`${meTs ? 'The other phone' : 'This phone'} offered no Tailscale address. Switch Tailscale on there, and make sure loversrock is not in its excluded apps.`);
  } else {
    lines.push('Neither phone offered a Tailscale address. With Tailscale on both phones, calls connect without a relay.');
  }
  return lines.join('\n');
}
