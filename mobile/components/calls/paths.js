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
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith('fd7a:115c:a1e0:')) return 'Tailscale';
    if (v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd')) return 'local network';
    return 'IPv6';
  }
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

// What a phone may tell the other phone about itself. Its Tailscale address,
// its home-network address and the relay (itself on the tailnet) say nothing
// about where it is on the internet; its public IPv4 or IPv6 address does, so
// that never leaves the phone.
const PRIVATE = new Set(['Tailscale', 'local network', 'relay']);

export const isPrivateCandidate = (line) => PRIVATE.has(candidateLabel(line));

/**
 * A candidate with its related address blanked. A relay candidate names the
 * address the phone reached the relay from (raddr); that is not needed to
 * connect, so it goes out as 0.0.0.0, as browsers do.
 */
export const scrubCandidate = (line) => String(line)
  .replace(/ raddr \S+ rport \d+/, ' raddr 0.0.0.0 rport 0');

/**
 * An SDP that says nothing about where the phone is on the internet: every
 * public-address candidate taken out, the rest scrubbed, and the default
 * connection address (c=, a=rtcp:) blanked. ICE ignores those two; only an
 * old non-ICE endpoint would use them.
 */
export function privateSdp(sdp) {
  if (!sdp) return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  return sdp.split(eol)
    .filter((l) => !l.startsWith('a=candidate:') || isPrivateCandidate(l))
    .map((l) => {
      if (l.startsWith('a=candidate:')) return scrubCandidate(l);
      if (l.startsWith('c=IN ')) return 'c=IN IP4 0.0.0.0';
      if (l.startsWith('a=rtcp:')) return l.replace(/^a=rtcp:(\d+) IN IP[46] \S+/, 'a=rtcp:$1 IN IP4 0.0.0.0');
      return l;
    })
    .join(eol);
}
