/*
 * nav.js
 * The top bar:
 *   1. Underlines "On the clock" or "Off the clock" while you're in that chapter of the page.
 *   2. On phones, gives the bar a solid background while the experience timeline is on screen. Elsewhere the bar
 *      inverts the colors underneath it; over the timeline, whose text scrolls right under the bar, solid reads better.
 */
(function (Site) {
  "use strict";

  const PHONE_MAXIMUM_WIDTH = 760;   // matches the phone breakpoint in css/responsive.css

  const navElement = document.querySelector(".nav");
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

  function measureNav() {
    navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")) || 56;
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
