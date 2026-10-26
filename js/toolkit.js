/*
 * toolkit.js
 * The toolkit ticker: two rows of skills that drift sideways, speeding up while you scroll.
 */
(function (Site) {
  "use strict";

  /* ---------- Settings you can tweak ---------- */

  const TICKER = {
    speed: 0.9,          // base speed, in pixels per frame
    scrollBoost: 0.35,   // extra speed per pixel of scroll movement
    maxBoost: 18
  };

  const toolkit = document.querySelector(".toolkit");

  // Each row gets a duplicate of its track so the loop has no seam.
  const rows = Array.from(document.querySelectorAll(".ticker-row")).map((rowElement) => {
    const track = rowElement.querySelector(".ticker-track");
    if (Site.motionEnabled) {
      const duplicate = track.cloneNode(true);
      duplicate.setAttribute("aria-hidden", "true");
      rowElement.appendChild(duplicate);
    }
    return {
      element: rowElement,
      track,
      direction: parseFloat(rowElement.getAttribute("data-direction")),   // -1 = left, 1 = right
      offset: 0,
      trackWidth: 1
    };
  });

  function measureTicker() {
    rows.forEach((row) => { row.trackWidth = row.track.offsetWidth || 1; });
  }

  function updateTicker(now, framesElapsed) {
    const toolkitBox = toolkit.getBoundingClientRect();
    if (toolkitBox.bottom < 0 || toolkitBox.top > Site.viewportHeight) {
      return; // off screen: skip
    }
    const boost = Math.min(Math.abs(Site.velocity) * TICKER.scrollBoost, TICKER.maxBoost);
    rows.forEach((row) => {
      row.offset += row.direction * (TICKER.speed + boost) * framesElapsed;
      if (row.offset <= -row.trackWidth) {
        row.offset += row.trackWidth;
      }
      if (row.offset > 0) {
        row.offset -= row.trackWidth;
      }
      row.element.style.transform = "translate3d(" + row.offset.toFixed(1) + "px,0,0)";
    });
  }

  if (Site.motionEnabled) {
    Site.onMeasure(measureTicker);
    Site.onFrame(updateTicker);
  }
})(window.Site);
