/**
 * Shared utilities used across Thoth scripts.
 */

/**
 * Format a timestamp as a human-readable "X ago" string.
 * @param {string|Date} isoString - ISO 8601 date string or Date object.
 * @returns {string} Human-readable relative time.
 */
function timeAgo(isoString) {
  if (!isoString) return 'never';
  const ts = isoString instanceof Date ? isoString.getTime() : new Date(isoString).getTime();
  if (isNaN(ts)) return 'never';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

module.exports = { timeAgo };
