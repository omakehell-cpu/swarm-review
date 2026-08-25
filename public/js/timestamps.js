// public/js/timestamps.js -- upgrades every <time class="ts"> element
// (server-rendered with a UTC fallback) to the viewer's local time, or a
// short relative form ("3h ago") for recent timestamps. Runs on every
// page. No dependencies.
(function () {
  'use strict';

  function relativeOrLocal(date) {
    const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
    if (diffSec < 45) return 'just now';
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.round(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  document.querySelectorAll('time.ts').forEach((el) => {
    const iso = el.getAttribute('datetime');
    if (!iso) return;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    el.textContent = relativeOrLocal(date);
    el.title = date.toLocaleString();
  });
})();
