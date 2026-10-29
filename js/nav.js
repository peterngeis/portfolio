/*
 * nav.js
 * The top bar:
 *   1. Underlines "On the clock" or "Off the clock" while you're in that chapter of the page.
 *   2. On phones, gives the bar a solid background while the experience timeline is on screen. Elsewhere the bar
 *      inverts the colors underneath it; over the timeline, whose text scrolls right under the bar, solid reads better.
 *   3. Keeps the bar on one line with the font that actually loaded (see fitBar below).
 */
(function (Site) {
  "use strict";

  const PHONE_MAXIMUM_WIDTH = 760;   // matches the phone breakpoint in css/responsive.css
  const SMALLEST_FIT = 0.8;          // the bar's text never shrinks below this share of its size in css/base.css

  const navElement = document.querySelector(".nav");
  const barRow = navElement.querySelector(".wrap");
  const brand = navElement.querySelector(".brand");
  const linkGroup = navElement.querySelector(".nav-links");
  const solidZones = Array.from(document.querySelectorAll(".experience"));

  // Each chapter runs from its first section to its last. The link is current while the middle of the screen is inside.
  const chapters = [
    { link: navElement.querySelector('a[href="#on-the-clock"]'), first: "#on-the-clock", last: "#senior-design" },
    { link: navElement.querySelector('a[href="#off-the-clock"]'), first: "#off-the-clock", last: "#builds" }
  ].map((chapter) => ({
    link: chapter.link,
    first: document.querySelector(chapter.first),
    last: document.querySelector(chapter.last)
  })).filter((chapter) => chapter.link && chapter.first && chapter.last);

  let navHeight = 56;
  let wasSolid = false;
  let currentLink = null;

  // The bar's sizes in css/base.css and css/responsive.css fit common phones, but text width depends on the font that
  // actually loaded. If the name, the links, and the pause button need more room than the bar has, the text and its
  // spacing shrink together (through --nav-fit) until they fit. Runs on load, on resize, and when the web font arrives.
  function fitBar() {
    navElement.style.removeProperty("--nav-fit");
    let fit = 1;
    for (let pass = 0; pass < 4; pass += 1) {
      const rowStyle = getComputedStyle(barRow);
      const room = barRow.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight);
      const needed = brand.getBoundingClientRect().width + (parseFloat(rowStyle.columnGap) || 0)
        + linkGroup.getBoundingClientRect().width;
      if (needed <= room || fit <= SMALLEST_FIT) {
        return;
      }
      fit = Math.max(SMALLEST_FIT, fit * (room / needed) - 0.005);
      navElement.style.setProperty("--nav-fit", fit.toFixed(3));
    }
  }

  function measureNav() {
    navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")) || 56;
    fitBar();
  }

  function updateNav() {
    let isSolid = false;
    if (Site.viewportWidth <= PHONE_MAXIMUM_WIDTH) {
      for (const zone of solidZones) {
        const zoneBox = zone.getBoundingClientRect();
        if (zoneBox.top <= navHeight && zoneBox.bottom > navHeight) {
          isSolid = true;
        }
      }
    }
    if (isSolid !== wasSolid) {
      navElement.classList.toggle("is-solid", isSolid);
      wasSolid = isSolid;
    }

    const middle = Site.viewportHeight / 2;
    let link = null;
    for (const chapter of chapters) {
      if (chapter.first.getBoundingClientRect().top <= middle && chapter.last.getBoundingClientRect().bottom > middle) {
        link = chapter.link;
      }
    }
    if (link !== currentLink) {
      if (currentLink) {
        currentLink.classList.remove("is-current");
        currentLink.removeAttribute("aria-current");
      }
      if (link) {
        link.classList.add("is-current");
        link.setAttribute("aria-current", "location");
      }
      currentLink = link;
    }
  }

  Site.onMeasure(measureNav);
  Site.onFrame(updateNav);
})(window.Site);
