/*
 * scroll-pause.js
 * Pauses the page on full-screen frames, the way the build photo holds still while you scroll.
 *
 * A frame is marked up in index.html as:
 *
 *   <div class="scroll-pause" data-pause="name">
 *     <div class="the-frame"> ... </div>      
 *   </div>
 *
 * When the frame fits on screen, it sticks in the middle of the screen and the page keeps scrolling
 * for a short "runway" before releasing it. If the same data-pause name appears on a nested wrapper, 
 * the outer one is tried first and the inner one is the fallback for small screens.
 */
(function (Site) {
  "use strict";

  /* ---------- Settings you can tweak ---------- */

  const SCROLL_PAUSE = {
    distance: 0.4,       // how long a frame holds, as a fraction of the screen height
    minimumRoom: 16       // a frame only pauses if it fits on screen with at least this many pixels to spare
  };

  const root = document.documentElement;
  const wrappers = Array.from(document.querySelectorAll(".scroll-pause"));

  // Wrappers grouped by their data-pause name, outermost first.
  const wrappersByName = {};
  wrappers.forEach((wrapper) => {
    const name = wrapper.getAttribute("data-pause");
    if (!wrappersByName[name]) {
      wrappersByName[name] = [];
    }
    wrappersByName[name].push(wrapper);
  });

  function release(wrapper) {
    wrapper.classList.remove("is-pinned");
    wrapper.style.minHeight = "";
    wrapper.style.removeProperty("--pause-top");
  }

  function measurePauses() {
    const navHeight = parseFloat(getComputedStyle(root).getPropertyValue("--nav-height")) || 64;
    const runway = Math.round(Site.viewportHeight * SCROLL_PAUSE.distance);
    const chosenWrappers = {};

    wrappers.forEach(release);

    Object.keys(wrappersByName).forEach((name) => {
      Site.pauseFrames[name] = { active: false };
      if (!Site.motionEnabled) {
        return;
      }
      for (const wrapper of wrappersByName[name]) {
        const frameHeight = wrapper.firstElementChild.offsetHeight;
        const isFullScreen = wrapper.hasAttribute("data-full-screen");
        const room = isFullScreen ? Site.viewportHeight + 1 : Site.viewportHeight - navHeight - SCROLL_PAUSE.minimumRoom;
        if (frameHeight > room) {
          continue;
        }
        // Full-screen frames stick at the very top; the others stick centered in the space below the nav bar.
        const stickTop = isFullScreen ? 0 : Math.round(navHeight + (Site.viewportHeight - navHeight - frameHeight) / 2);
        wrapper.classList.add("is-pinned");
        wrapper.style.setProperty("--pause-top", stickTop + "px");
        wrapper.style.minHeight = (frameHeight + runway) + "px";
        chosenWrappers[name] = { wrapper, stickTop };
        break;
      }
    });

    // Every runway is in place now, so document positions are final.
    Object.keys(chosenWrappers).forEach((name) => {
      const { wrapper, stickTop } = chosenWrappers[name];
      const wrapperTop = Site.documentTop(wrapper);
      const pinStart = wrapperTop - stickTop;
      Site.pauseFrames[name] = { active: true, wrapperTop, pinStart, pinEnd: pinStart + runway, stickTop };
    });
  }

  Site.onMeasure(measurePauses, 20);
})(window.Site);
